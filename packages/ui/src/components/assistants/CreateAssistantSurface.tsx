import React from 'react';

import { MobileFullscreenSurface } from '@/apps/MobileFullscreenSurface';
import { Icon } from '@/components/icon/Icon';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { createAssistant } from '@/lib/assistants/assistantActions';
import { useI18n } from '@/lib/i18n';
import { getAssistantsRoot, slugifyAssistantName } from '@/lib/assistants/assistantMetadata';
import { cn } from '@/lib/utils';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

/**
 * Assistants fork: "New assistant". Name, role, face (an image uploaded as the
 * project icon), colour and default model; `createAssistant` does the rest.
 * Full-screen on the phone, a dialog on the desktop.
 */

const COLORS = ['#e5a50a', '#f66151', '#c061cb', '#3584e4', '#2ec27e', '#ff7800', '#99c1f1', '#9a9996'];
const ACCEPTED = 'image/png,image/jpeg,image/svg+xml';

const CreateAssistantForm: React.FC<{ onDone: () => void; compact: boolean }> = ({ onDone, compact }) => {
  const { t } = useI18n();
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('');
  const [color, setColor] = React.useState(COLORS[0]);
  const [providerId, setProviderId] = React.useState('');
  const [modelId, setModelId] = React.useState('');
  const [avatar, setAvatar] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!avatar) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatar);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatar]);

  const slug = slugifyAssistantName(name);
  const root = getAssistantsRoot(homeDirectory);
  const canSubmit = Boolean(slug && root) && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await createAssistant({
        name,
        role,
        color,
        defaultModel: providerId && modelId ? `${providerId}/${modelId}` : '',
        avatar,
      });
      for (const warning of result.warnings) toast.warning(warning);
      toast.success(t('assistants.ready', { name: name.trim() }));
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('assistants.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const avatarSize = compact ? 88 : 104;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative flex items-center justify-center overflow-hidden rounded-full transition-transform active:scale-95"
          style={{
            width: avatarSize,
            height: avatarSize,
            background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 34%, transparent), color-mix(in srgb, ${color} 10%, transparent) 70%)`,
          }}
          aria-label={t('assistants.chooseFace')}
        >
          {preview ? (
            <img src={preview} alt="" className="size-[92%] object-contain" />
          ) : (
            <span className="font-semibold" style={{ color, fontSize: avatarSize * 0.42 }}>
              {name.trim().charAt(0).toUpperCase() || <Icon name="image-2" className="size-7" />}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-black/45 text-white opacity-90">
            <Icon name="camera" className="size-4" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(event) => setAvatar(event.target.files?.[0] ?? null)}
        />
        <span className="typography-micro text-muted-foreground">{t('assistants.imageFormats')}</span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="typography-meta font-medium text-muted-foreground">{t('assistants.name')}</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('assistants.namePlaceholder')} autoFocus={!compact} />
        <span className="min-h-4 typography-micro text-muted-foreground">
          {slug && root ? t('assistants.workspace', { path: `${root}/${slug}` }) : ''}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="typography-meta font-medium text-muted-foreground">{t('assistants.role')}</span>
        <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder={t('assistants.rolePlaceholder')} />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="typography-meta font-medium text-muted-foreground">{t('assistants.colour')}</span>
        <div className="flex flex-wrap gap-2.5">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              aria-label={swatch}
              aria-pressed={swatch === color}
              className={cn(
                'size-8 rounded-full transition-transform',
                swatch === color ? 'scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'hover:scale-105',
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="typography-meta font-medium text-muted-foreground">{t('assistants.defaultModel')}</span>
        <ModelSelector
          providerId={providerId}
          modelId={modelId}
          className="max-w-full justify-between"
          dropdownPortalToBody
          placeholder={t('assistants.serverDefault')}
          onChange={(nextProvider, nextModel) => {
            setProviderId(nextProvider);
            setModelId(nextModel);
          }}
        />
      </div>

      <Button type="submit" disabled={!canSubmit} className="mt-1 w-full">
        {busy ? <Icon name="loader-4" className="size-4 animate-spin" /> : <Icon name="sparkling" className="size-4" />}
        {t('assistants.create')}
      </Button>
    </form>
  );
};

export const CreateAssistantSurface: React.FC<{
  open: boolean;
  onClose: () => void;
  variant: 'phone' | 'desktop';
}> = ({ open, onClose, variant }) => {
  const { t } = useI18n();
  if (variant === 'phone') {
    return (
      <MobileFullscreenSurface open={open} onClose={onClose} title={t('assistants.new')} ariaLabel={t('assistants.new')}>
        <div className="overflow-y-auto px-4 pb-8 pt-2">
          {open ? <CreateAssistantForm onDone={onClose} compact /> : null}
        </div>
      </MobileFullscreenSurface>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assistants.new')}</DialogTitle>
        </DialogHeader>
        {open ? <CreateAssistantForm onDone={onClose} compact={false} /> : null}
      </DialogContent>
    </Dialog>
  );
};
