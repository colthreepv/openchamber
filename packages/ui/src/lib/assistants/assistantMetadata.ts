import { z } from 'zod';

import type { Session } from '@/lib/opencode/model';

/**
 * Assistants fork: the session markers an assistant is built from.
 *
 * - `metadata.openchamber.assistant = { name, role, canonical, version }` marks
 *   the one long-lived conversation of an assistant (its "canonical" session).
 *   The project that owns the session's directory is the assistant's identity:
 *   label, colour, iconImage (the face) and defaultModel.
 * - `metadata.openchamber.startedBy = { sessionID }` is written by the server
 *   when a session's agent starts another session through the openchamber
 *   tool (`session.create`). It links a work session to its starter across
 *   folders. The first user message also carries `openchamber.promptedBy`;
 *   the session-level mark exists so lists do not have to read messages.
 *
 * A legacy top-level `metadata.assistant` (early proof of concept) is still
 * read so an unmigrated record keeps its assistant.
 */

const ASSISTANT_MARKER_VERSION = 1;

const assistantMarkerSchema = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().catch('').optional(),
  canonical: z.boolean().catch(false).optional(),
  version: z.number().optional(),
});

type AssistantMarker = {
  name: string;
  role: string;
  canonical: boolean;
};

const namespacedMarkerSchema = z.object({ openchamber: z.object({ assistant: assistantMarkerSchema }) });
const legacyMarkerSchema = z.object({ assistant: assistantMarkerSchema });
const startedBySchema = z.object({ openchamber: z.object({ startedBy: z.object({ sessionID: z.string().trim().min(1) }) }) });

export const readAssistantMarker = (session: Pick<Session, 'metadata'> | null | undefined): AssistantMarker | null => {
  const metadata = session?.metadata;
  if (!metadata) return null;
  const parsed = namespacedMarkerSchema.safeParse(metadata).data?.openchamber.assistant
    ?? legacyMarkerSchema.safeParse(metadata).data?.assistant;
  if (!parsed) return null;
  return { name: parsed.name, role: parsed.role ?? '', canonical: parsed.canonical === true };
};

export const isCanonicalAssistantSession = (session: Pick<Session, 'metadata'> | null | undefined): boolean => (
  readAssistantMarker(session)?.canonical === true
);

/** The session whose agent started this one, as the server recorded it on the session. */
export const readStartedBySessionId = (session: Pick<Session, 'metadata'> | null | undefined): string | null => (
  startedBySchema.safeParse(session?.metadata).data?.openchamber.startedBy.sessionID ?? null
);

/** The metadata patch that marks a canonical assistant session. */
export const buildAssistantMarkerPatch = (name: string, role: string) => ({
  openchamber: {
    assistant: { name: name.trim(), role: role.trim(), canonical: true, version: ASSISTANT_MARKER_VERSION },
  },
});

/** `My Assistant!` → `my-assistant`. Empty when nothing usable is left. */
export const slugifyAssistantName = (name: string): string => name
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

const trimTrailingSlash = (value: string): string => (value.length > 1 ? value.replace(/\/+$/, '') : value);

/** Where assistant workspaces live: `<home>/assistants`. */
export const getAssistantsRoot = (homeDirectory: string | null | undefined): string | null => {
  const home = homeDirectory?.trim();
  if (!home) return null;
  return `${trimTrailingSlash(home.replace(/\\/g, '/'))}/assistants`;
};

export const isAssistantWorkspacePath = (path: string | null | undefined, homeDirectory: string | null | undefined): boolean => {
  const root = getAssistantsRoot(homeDirectory);
  if (!root || !path) return false;
  const normalized = trimTrailingSlash(path.replace(/\\/g, '/'));
  if (!normalized.startsWith(`${root}/`)) return false;
  return !normalized.slice(root.length + 1).includes('/');
};

export const basenameOf = (path: string | null | undefined): string => {
  if (!path) return '';
  const normalized = trimTrailingSlash(path.replace(/\\/g, '/'));
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
};
