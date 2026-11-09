import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { checkTtsModels, listModels, makeTts } from '../src/speech.ts';
import type { SpeechService } from '../src/store.ts';

// Stand-ins for speech services: /a/v1 answers like OpenAI, /s/v1 like Speaches (each model says what it
// is for, voices are listed with the model), /b has no list at all, /c is a broken Cloudflare tunnel.
let server: http.Server;
let base: string;
let lastAuthorization: string | undefined;

const SPEACHES_MODELS = {
  data: [
    { id: 'Systran/faster-distil-whisper-small.en', task: 'automatic-speech-recognition' },
    { id: 'speaches-ai/Kokoro-82M-v1.0-ONNX', task: 'text-to-speech', voices: [{ id: 'af_heart' }, { id: 'am_adam' }] },
    { id: 'silero_vad_v5', task: 'voice-activity-detection' },
  ],
};

before(async () => {
  server = http.createServer((req, res) => {
    lastAuthorization = req.headers.authorization;
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.url === '/a/v1/models') {
      json({ object: 'list', data: [{ id: 'whisper-1' }, { id: 'kokoro' }, { id: 'tts-1' }, { id: 'kokoro' }] });
    } else if (req.url === '/s/v1/models') {
      json(SPEACHES_MODELS);
    } else if (req.url === '/s/v1/audio/speech' && req.method === 'POST') {
      // Like some self-hosted servers: lists one name, speaks only with another.
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c));
      req.on('end', () => {
        const { model, voice } = JSON.parse(raw) as { model: string; voice: string };
        if (model === 'kokoro' && voice === 'af_heart') return res.end(Buffer.alloc(4800));
        res.statusCode = 400;
        json({ detail: { error: 'invalid_model', message: `Unsupported model: ${model}` } });
      });
    } else if (req.url?.startsWith('/c/')) {
      res.statusCode = 530;
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html><head><title>Cloudflare Tunnel error | example.com</title></head><body>...</body></html>');
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const service = (path: string, model = ''): SpeechService => ({ provider: 'openai', baseUrl: `${base}${path}`, apiKey: 'k', model });

test('models are listed once each, the likely ones for the job first', async () => {
  assert.deepEqual(await listModels(service('/a/v1'), 'tts'), { models: ['kokoro', 'tts-1', 'whisper-1'], baseUrl: `${base}/a/v1` });
  assert.deepEqual((await listModels(service('/a/v1/'), 'stt'))?.models, ['whisper-1', 'kokoro', 'tts-1']);
  assert.equal(lastAuthorization, 'Bearer k');
});

test('models a server marks as being for another job are left out', async () => {
  assert.deepEqual((await listModels(service('/s/v1'), 'tts'))?.models, ['speaches-ai/Kokoro-82M-v1.0-ONNX']);
  assert.deepEqual((await listModels(service('/s/v1'), 'stt'))?.models, ['Systran/faster-distil-whisper-small.en']);
});

test('a base URL without /v1 is found with it', async () => {
  const found = await listModels(service('/s'), 'tts');
  assert.equal(found?.baseUrl, `${base}/s/v1`);
  assert.deepEqual(found?.models, ['speaches-ai/Kokoro-82M-v1.0-ONNX']);
});

test('TTS models are tried: the ones that speak come first, listed ones that are refused go', async () => {
  const listed = (await listModels(service('/s/v1'), 'tts'))!.models;
  const checked = await checkTtsModels(service('/s/v1'), listed);
  assert.deepEqual(checked.models, ['kokoro']);
  assert.match(checked.message ?? '', /refused for speech: speaches-ai\/Kokoro-82M-v1\.0-ONNX/);
});

test('when nothing speaks, the list stays and the reason is given', async () => {
  const checked = await checkTtsModels(service('/a/v1'), ['kokoro', 'tts-1']);
  assert.deepEqual(checked.models, ['kokoro', 'tts-1']);
  assert.match(checked.message ?? '', /None of the likely models spoke.*404/);
});

test('a service without a model list gives null', async () => {
  assert.equal(await listModels(service('/b'), 'tts'), null);
});

test('without a voice list, the voices come from the model entry', async () => {
  assert.deepEqual(await makeTts(service('/s/v1', 'speaches-ai/Kokoro-82M-v1.0-ONNX')).voices(), ['af_heart', 'am_adam']);
});

test('a Cloudflare tunnel error is explained, not dumped as HTML', async () => {
  await assert.rejects(listModels(service('/c/v1'), 'tts'), (err: Error) => {
    assert.match(err.message, /530: Cloudflare can't reach the server behind its tunnel/);
    assert.doesNotMatch(err.message, /<html|doctype/i);
    return true;
  });
});
