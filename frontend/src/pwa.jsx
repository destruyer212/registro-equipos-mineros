import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Share, Wifi, X } from 'lucide-react';

const supportsApp = import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator;

export function usePwa() {
  const [worker, setWorker] = useState(null);
  const [ready, setReady] = useState(() => supportsApp && Boolean(navigator.serviceWorker.controller));
  const [updating, setUpdating] = useState(false);
  const reloadForUpdate = useRef(false);
  useEffect(() => {
    if (!supportsApp) return;
    const serviceWorker = navigator.serviceWorker;
    let registration;
    let installing;
    let active = true;

    function checkWaiting() {
      if (!active) return;
      setReady(Boolean(serviceWorker.controller));
      setWorker(serviceWorker.controller ? registration?.waiting ?? null : null);
    }

    function controllerChanged() {
      if (reloadForUpdate.current) window.location.reload();
      else checkWaiting();
    }

    function watchInstall() {
      installing?.removeEventListener('statechange', checkWaiting);
      installing = registration.installing;
      installing?.addEventListener('statechange', checkWaiting);
    }

    serviceWorker.addEventListener('controllerchange', controllerChanged);
    serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((result) => {
      if (!active) return;
      registration = result;
      registration.addEventListener('updatefound', watchInstall);
      watchInstall();
      checkWaiting();
    }).catch((error) => console.warn('MinaControl no pudo preparar el modo sin conexión.', error.message));

    return () => {
      active = false;
      serviceWorker.removeEventListener('controllerchange', controllerChanged);
      registration?.removeEventListener('updatefound', watchInstall);
      installing?.removeEventListener('statechange', checkWaiting);
    };
  }, []);

  const update = worker && (() => {
    reloadForUpdate.current = true;
    setUpdating(true);
    worker.postMessage('ACTIVATE_UPDATE');
  });
  return { ready, update, updating };
}

export function InstallApp({ offlineReady }) {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const dialog = useRef(null);
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(navigator.userAgent);

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
        <div className="install-device">{appleMobile ? <Share size={18} /> : <Download size={18} />}
          <strong>{appleMobile ? 'iPhone y iPad' : android ? 'Android' : 'Instalación desde el navegador'}</strong>
        </div>
        <ol className="install-steps">
          <li>{appleMobile ? 'Abre este portal en Safari y toca Compartir.' : 'Abre el menú de tu navegador.'}</li>
          <li>{appleMobile ? 'Elige Añadir a pantalla de inicio y confirma con Añadir.' :
            'Elige Instalar aplicación o Añadir a pantalla de inicio y confirma.'}</li>
          <li>Abre MinaControl desde el icono de la aplicación.</li>
        </ol>
        <div className="install-status">
          {offlineReady ? <CheckCircle2 size={18} /> : <Wifi size={18} />}
          <div><strong>{offlineReady ? 'Lista para consultar sin conexión' : 'Prepara la consulta sin conexión'}</strong>
            <p>{offlineReady ? 'El inventario ya está guardado en este navegador.' : 'Mantén la app abierta con conexión hasta que termine de cargar el inventario.'}</p>
          </div>
        </div>
      </div>
    </dialog>
  </>;
}
