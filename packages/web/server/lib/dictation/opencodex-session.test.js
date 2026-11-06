import { describe, it, expect } from 'vitest';
import { WebSocketServer } from 'ws';
import { once } from 'events';
import { OpenCodexTranscriptionSession } from './opencodex-session.js';

async function fixture(onMessage) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  server.on('connection', (socket, request) => {
    expect(request.headers['x-opencodex-api-key']).toBe('test-key');
    socket.on('message', (raw) => onMessage(socket, JSON.parse(raw.toString())));
  });
  const session = new OpenCodexTranscriptionSession({ baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-key' });
  return { server, session };
}

describe('OpenCodex streaming session', () => {
  it('streams audio and replaces revisions before finalizing on close', async () => {
    const frames = [];
    const { server, session } = await fixture((socket, event) => {
      frames.push(event.type);
      if (event.type === 'session.start') socket.send(JSON.stringify({ type: 'session.started' }));
      if (event.type === 'audio.append') {
        socket.send(JSON.stringify({ type: 'transcript.segment', utterance_id: 'one', revision: 1, text: 'old' }));
        socket.send(JSON.stringify({ type: 'transcript.final', utterance_id: 'one', revision: 2, text: 'new' }));
        socket.send(JSON.stringify({ type: 'transcript.segment', utterance_id: 'one', revision: 1, text: 'stale' }));
      }
      if (event.type === 'session.close') socket.send(JSON.stringify({ type: 'session.updated', session: { status: 'closed' } }));
    });
    await session.connect();
    const transcript = once(session, 'transcript');
    let committed = false;
    session.on('committed', () => { committed = true; });
    session.appendPcm16(Buffer.alloc(3200));
    session.commit();
    expect(committed).toBe(true);
    expect((await transcript)[0].transcript).toBe('new');
    expect(frames).toEqual(['session.start', 'audio.append', 'session.close']);
    session.close(); server.close();
  });

  it('reports an unexpected upstream close', async () => {
    const { server, session } = await fixture((socket, event) => {
      if (event.type === 'session.start') socket.send(JSON.stringify({ type: 'session.started' }));
      if (event.type === 'audio.append') socket.close();
    });
    await session.connect();
    const error = once(session, 'error');
    session.appendPcm16(Buffer.alloc(2));
    expect((await error)[0].message).toMatch(/closed unexpectedly/);
    session.close(); server.close();
  });

  it('closes upstream on cancel', async () => {
    let upstream;
    const { server, session } = await fixture((socket, event) => {
      upstream = socket;
      if (event.type === 'session.start') socket.send(JSON.stringify({ type: 'session.started' }));
    });
    await session.connect();
    const closed = once(upstream, 'close');
    session.close();
    await closed;
    server.close();
  });
});
