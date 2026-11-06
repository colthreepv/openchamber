import React from 'react';

import type { ProjectEntry } from '@/lib/api/types';
import { ProjectIconImage, resolveProjectColor } from '@/lib/projectMeta';
import { cn } from '@/lib/utils';

/**
 * Assistants fork: an assistant's face. The project's uploaded icon image,
 * round, on a soft tint of the project colour; without an image, the initial
 * on that tint. A running assistant gets a static info-coloured mark.
 */
export const AssistantAvatar: React.FC<{
  project: Pick<ProjectEntry, 'id' | 'iconImage' | 'color' | 'iconBackground'>;
  name: string;
  /** Pixel size of the circle. */
  size?: number;
  running?: boolean;
  className?: string;
}> = ({ project, name, size = 48, running = false, className }) => {
  const color = resolveProjectColor(project.color) ?? 'var(--primary-base)';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const fallback = (
    <span
      className="flex size-full items-center justify-center font-semibold"
      style={{ color, fontSize: Math.round(size * 0.42) }}
    >
      {initial}
    </span>
  );
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 30%, transparent), color-mix(in srgb, ${color} 10%, transparent) 70%)`,
        }}
        aria-hidden
      />
      <span className="relative flex size-full items-center justify-center overflow-hidden rounded-full">
        {project.iconImage ? (
          <ProjectIconImage
            project={{ id: project.id, iconImage: project.iconImage }}
            className="size-[92%] object-contain"
            alt=""
            fallback={fallback}
          />
        ) : fallback}
      </span>
      {running ? (
        <span
          className="pointer-events-none absolute bottom-0 inset-e-0 size-2.5 rounded-full bg-status-info"
          aria-hidden
        />
      ) : null}
    </span>
  );
};
