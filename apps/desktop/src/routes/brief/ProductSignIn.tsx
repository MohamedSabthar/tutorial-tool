import { useEffect, useState } from 'react';
import type { SignInStatus } from '@studio/core';
import { Button, Chip } from '@studio/ui';
import { useEngine } from '../../engine';

/**
 * The product's sign-in profile: open the product to sign in once, and every dry run and
 * recording starts signed in from a copy of it.
 */
export function ProductSignIn({ product, name }: { product: string; name: string }) {
  const { client, state } = useEngine();
  const [status, setStatus] = useState<SignInStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('product.signInStatus', { product }).then(setStatus, () => undefined);
    return client.on('product.signInChanged', (s) => s.product === product && setStatus(s));
  }, [client, state, product]);

  const act = async (method: 'product.signIn' | 'product.signOut') => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await client.call(method, { product }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const when = status?.updatedAt ? new Date(status.updatedAt).toLocaleString() : null;
  return (
    <div className="signin" role="group" aria-label={`${name} sign-in`}>
      <div className="signin-row">
        <Chip tone={status?.open ? 'active' : status?.saved ? 'ok' : 'neutral'}>
          {status?.open ? 'Sign-in window open' : status?.saved ? 'Signed-in profile saved' : 'Signed out'}
        </Chip>
        {status?.open ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !status}
            onClick={() => void act('product.signIn')}
          >
            {status?.saved ? `Open ${name} to update sign-in` : `Sign in to ${name}`}
          </Button>
        )}
        {status?.saved && !status.open ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('product.signOut')}>
            Forget sign-in
          </Button>
        ) : null}
      </div>
      <p className="signin-hint">
        {status?.open
          ? `Sign in in the ${name} window, then quit it (⌘Q). Recordings wait until it's closed.`
          : status?.saved
            ? `Recordings start from a copy of this profile, so they're signed in.${when ? ` Last changed ${when}.` : ''}`
            : `Recordings start signed out. Sign in once if the tutorial needs an account.`}
      </p>
      {error ? (
        <p className="signin-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
