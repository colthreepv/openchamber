import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import { normalizeCustomOpenAIBaseURL } from '../tts/base-url.js';

const MAX_SESSION_MS = 300_000;
const MAX_AUDIO_BYTES = 48000;

export class OpenCodexTranscriptionSession extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.requiredSampleRate = 16000;
    this.segments = false;
    this.segmentId = randomUUID();
    this.utterances = new Map();
    this.closed = false;
    this.committed = false;
  }

  async connect() {
    const normalized = normalizeCustomOpenAIBaseURL(this.config.baseURL);
    if (normalized.error || !normalized.value) throw new Error(normalized.error || 'Custom STT server URL is not configured');
    const url = new URL(`${normalized.value}/audio/transcriptions/stream`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: this.config.apiKey ? { 'x-opencodex-api-key': this.config.apiKey } : {}, handshakeTimeout: 15000 });
    this.socket = socket;
    await new Promise((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error('OpenCodex dictation connection timed out')); }, 15000);
      const fail = (message) => {
        if (this.closed) return;
        if (!ready) { clearTimeout(timeout); this.closed = true; socket.terminate(); reject(new Error(message)); }
        else {
          clearTimeout(this.timer);
          this.emit('error', new Error(message));
        }
      };
      socket.on('open', () => socket.send(JSON.stringify({ type: 'session.start', config: {
        input_audio_format: 'pcm16', sample_rate_hz: 16000, num_channels: 1,
        max_buffer_size_bytes: 4194304, max_utterance_duration_ms: 30000, session_ttl_ms: MAX_SESSION_MS,
        provider_mode: 'streaming_sse', transcript_delivery_mode: 'segment',
        vad: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
      } })));
      socket.on('message', (raw) => {
        let event;
        try { event = JSON.parse(raw.toString()); } catch { fail('Invalid OpenCodex dictation response'); return; }
        if (event.type === 'session.started' && !ready) {
          ready = true; clearTimeout(timeout);
          this.timer = setTimeout(() => fail('OpenCodex dictation is limited to five minutes'), MAX_SESSION_MS);
          resolve();
        } else if (event.type === 'transcript.segment' || event.type === 'transcript.final') {
          const parsed = z.object({ utterance_id: z.string(), revision: z.number(), text: z.string() }).safeParse(event);
          if (!parsed.success) return;
          const { utterance_id: id, revision, text } = parsed.data;
          const previous = this.utterances.get(id);
          if (!previous || revision > previous.revision) this.utterances.set(id, { revision, text });
        } else if (event.type === 'session.updated' && event.session?.status === 'closed') {
          if (!this.committed) { fail('OpenCodex dictation closed unexpectedly'); return; }
          this.finished = true;
          this.emit('transcript', { segmentId: this.segmentId, transcript: [...this.utterances.values()].map((v) => v.text.trim()).filter(Boolean).join(' '), isFinal: true });
        } else if (event.type === 'error') {
          fail('OpenCodex dictation failed');
        }
      });
      socket.on('error', () => fail('OpenCodex dictation connection failed'));
      socket.on('close', () => { if (!this.finished) fail('OpenCodex dictation connection closed unexpectedly'); });
    });
  }

  appendPcm16(buffer) {
    for (let offset = 0; offset < buffer.length; offset += MAX_AUDIO_BYTES) {
      this.socket.send(JSON.stringify({ type: 'audio.append', audio: buffer.subarray(offset, offset + MAX_AUDIO_BYTES).toString('base64') }));
    }
  }

  commit() {
    this.committed = true;
    this.emit('committed', { segmentId: this.segmentId, previousSegmentId: null });
    this.socket.send(JSON.stringify({ type: 'session.close' }));
  }

  clear() {}

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.socket?.terminate();
  }
}
