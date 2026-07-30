import { LogoMark } from './Icons';
import { Wordmark } from './Wordmark';
import type { EngineError } from '../audio/AudioEngine';

interface Props {
  starting: boolean;
  error: EngineError | null;
  onStart: () => void;
}

/**
 * First-run / permission screen.
 *
 * Also serves as the required user gesture: iOS will not let an AudioContext
 * leave the suspended state outside of one.
 */
export function MicGate({ starting, error, onStart }: Props) {
  const insecure = error?.kind === 'insecure-context';

  return (
    <div className="splash">
      <div className="splash__mark">
        <LogoMark size={56} />
      </div>
      <Wordmark className="splash__title wordmark" />
      <div className="splash__eyebrow">Chromatic Instrument Tuner</div>

      {error ? (
        <>
          <p className="splash__text splash__error">{error.message}</p>
          {error.kind === 'permission-denied' && (
            <p className="splash__note">
              Your browser remembers this choice per site. Open the padlock or the site
              settings in the address bar, allow the microphone, then reload.
            </p>
          )}
          {insecure && (
            <p className="splash__note">
              Browsers only expose microphones on <code>https://</code> or{' '}
              <code>localhost</code>. Run <code>npm run host</code> for an HTTPS address you
              can open on your phone.
            </p>
          )}
        </>
      ) : (
        <p className="splash__text">
          Play a note and it listens through your microphone — no cables, no
          account, nothing leaves your device.
        </p>
      )}

      <button className="btn btn--primary" onClick={onStart} disabled={starting}>
        {starting ? 'Starting…' : error ? 'Try again' : 'Start tuning'}
      </button>

      {!error && (
        <p className="splash__note">
          Your browser will ask for microphone access. Audio is analysed on-device and
          never recorded or sent anywhere.
        </p>
      )}
    </div>
  );
}
