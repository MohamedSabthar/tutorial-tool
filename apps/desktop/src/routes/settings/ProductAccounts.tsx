import { useEffect, useState } from 'react';
import type { ProductInfo, SignInStatus } from '@studio/core';
import { Button, StatusPill } from '@studio/ui';
import { useEngine } from '../../engine';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Product sign-ins (Settings → Accounts): one row per installed product. Signing in opens the
 * product on its saved profile; every dry run and recording starts from a copy of that profile,
 * so it's signed in (the WSO2 model provider, Copilot and other account features need this).
 */
export function ProductAccounts() {
  const { client, state } = useEngine();
  const [products, setProducts] = useState<ProductInfo[] | null>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('products.list', {}).then(setProducts, () => undefined);
  }, [client, state]);
  const shown = products?.filter((p) => p.available) ?? [];
  if (!shown.length) return null;
  return (
    <>
      {shown.map((p) => (
        <ProductAccount key={p.id} product={p} />
      ))}
    </>
  );
}

function ProductAccount({ product }: { product: ProductInfo }) {
  const { client, state } = useEngine();
  const [status, setStatus] = useState<SignInStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = product.name;

  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('product.signInStatus', { product: product.id }).then(setStatus, () => undefined);
    return client.on('product.signInChanged', (s) => s.product === product.id && setStatus(s));
  }, [client, state, product.id]);

  const act = async (method: 'product.signIn' | 'product.signOut') => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await client.call(method, { product: product.id }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const when = status?.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : null;
  const hintId = `st-signin-${product.id}`;
  return (
    <div className="st-block" role="group" aria-label={`${name} sign-in`}>
      <div className="st-row">
        <span className="st-name">{name}</span>
        <StatusPill
          tone={status?.open ? 'brand' : status?.saved ? 'positive' : 'neutral'}
          icon={status?.saved && !status.open ? 'check' : undefined}
        >
          {!status ? '…' : status.open ? 'Sign-in window open' : status.saved ? 'Sign-in saved' : 'Not signed in'}
        </StatusPill>
      </div>
      <p className="st-muted" id={hintId}>
        {status?.open
          ? `Sign in in the ${name} window, then quit it (⌘Q). Recordings wait until it's closed.`
          : status?.saved
            ? `Dry runs and recordings start from a copy of this sign-in.${when ? ` Last changed ${when}.` : ''} If a login has expired, open ${name} and sign in again.`
            : `Dry runs and recordings start signed out. Sign in once if your tutorials use an account (for example the WSO2 model provider).`}
      </p>
      {!status?.open && (
        <div className="st-inline">
          <Button
            variant={status?.saved ? 'secondary' : 'brand'}
            disabled={busy || !status}
            aria-describedby={hintId}
            onClick={() => void act('product.signIn')}
          >
            {status?.saved ? `Open ${name} to sign in again` : `Sign in to ${name}`}
          </Button>
          {status?.saved && (
            <Button variant="quiet" disabled={busy} onClick={() => void act('product.signOut')}>
              Forget sign-in
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
