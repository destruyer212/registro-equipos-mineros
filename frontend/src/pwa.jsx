import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

const supportsApp = import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator;

export function useAppUpdate() {
  const [worker, setWorker] = useState(null);
  useEffect(() => {
    if (!supportsApp) return;
    const serviceWorker = navigator.serviceWorker;
    let registration;
    let installing;
    let active = true;

    function checkWaiting() {
      if (active && serviceWorker.controller && registration.waiting) setWorker(registration.waiting);
    }

    function watchInstall() {
      installing?.removeEventListener('statechange', checkWaiting);
      installing = registration.installing;
      installing?.addEventListener('statechange', checkWaiting);
    }

    serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((result) => {
      if (!active) return;
      registration = result;
      registration.addEventListener('updatefound', watchInstall);
      watchInstall();
      checkWaiting();
    }).catch((error) => console.warn('MinaControl no pudo preparar el modo sin conexión.', error.message));

    return () => {
      active = false;
      registration?.removeEventListener('updatefound', watchInstall);
      installing?.removeEventListener('statechange', checkWaiting);
    };
  }, []);

  return worker && (() => {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    worker.postMessage('ACTIVATE_UPDATE');
  });
}

export function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const dialog = useRef(null);
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  useEffect(() => {
    if (!supportsApp) return;
    function capture(event) {
      event.preventDefault();
      setPrompt(event);
    }
    const completed = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', completed);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', completed);
    };
  }, []);

  if (!supportsApp || installed) return null;
  async function install() {
    if (prompt) {
      try {
        const result = await prompt.prompt();
        if (result?.outcome === 'accepted') setInstalled(true);
      } catch {
        dialog.current?.showModal();
      } finally {
        setPrompt(null);
      }
    } else {
      dialog.current.showModal();
    }
  }

  return <>
    <button className="secondary install-button" onClick={install}><Download size={17} /> Instalar app</button>
    <dialog ref={dialog} aria-labelledby="install-title">
      <div className="dialog-heading">
        <div><span className="dialog-eyebrow">MINACONTROL PWA</span><h2 id="install-title">Instalar MinaControl</h2></div>
        <button className="icon-button" aria-label="Cerrar" onClick={() => dialog.current.close()}><X size={22} /></button>
      </div>
      <div className="dialog-body">
        <p>{appleMobile
          ? 'En Safari, toca Compartir y elige Añadir a pantalla de inicio.'
          : 'Abre el menú de tu navegador y busca Instalar aplicación o Añadir a pantalla de inicio. En Chrome y Edge también puede aparecer un icono de instalación en la barra de direcciones.'}</p>
      </div>
    </dialog>
  </>;
}
