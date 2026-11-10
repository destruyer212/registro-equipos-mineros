import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, AlertCircle, ArrowRight, ArrowUpRight, ChevronDown, CircleCheck, Clock3,
  ClipboardList, Ellipsis, Gauge, History, LayoutDashboard, Pencil, Plus, Search,
  ShieldCheck, Truck, Wrench, X, Trash2, Layers3, Drill,
} from 'lucide-react';
import { api, apiDocsUrl, ApiUnavailableError, loadInventory, usesRender } from './api.js';
import { InstallApp, usePwa } from './pwa.jsx';
import './styles.css';

const number = new Intl.NumberFormat('es-PE');
const date = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' });
const statusNames = { operational: 'Operativo', upcoming: 'Próximo a servicio', due: 'Requiere mantenimiento' };
const typeDetails = {
  truck: { icon: Truck, detail: 'Transporte de material' },
  excavator: { icon: Layers3, detail: 'Excavación y carga' },
  drill: { icon: Drill, detail: 'Perforación' },
};
const views = [
  { id: 'overview', title: 'Vista general', icon: LayoutDashboard },
  { id: 'fleet', slug: 'flota', title: 'Flota de equipos', icon: Truck },
  { id: 'maintenance', slug: 'mantenimiento', title: 'Mantenimiento', icon: Wrench },
];
const emptyFilters = { search: '', type: '', status: 'all' };
const metrics = [
  { id: 'all', title: 'Equipos registrados', icon: Truck, caption: 'En el inventario activo' },
  { id: 'operational', title: 'Operativos', icon: CircleCheck, caption: 'Dentro del ciclo previsto' },
  { id: 'upcoming', title: 'Próximos a servicio', icon: Clock3, caption: 'Desde el 80 % del ciclo' },
  { id: 'due', title: 'Requieren mantenimiento', icon: Wrench, caption: 'Alcanzaron su intervalo' },
];
const snapshotKey = `minacontrol:inventory:v1:${apiDocsUrl}`;

function viewFromUrl() {
  const slug = new URLSearchParams(window.location.search).get('vista');
  return views.find((view) => view.slug === slug)?.id || 'overview';
}

function readSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(snapshotKey));
    if (Array.isArray(snapshot?.items) && Array.isArray(snapshot.types) && Number.isFinite(snapshot.savedAt)) return snapshot;
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function Status({ status }) {
  return <span className={`status ${status}`}><i />{statusNames[status]}</span>;
}

function Cycle({ equipment }) {
  const { cycleHours, intervalHours, status } = equipment;
  const progress = Math.min(100, (cycleHours / intervalHours) * 100);
  return (
    <div className={`cycle ${status}`}>
      <span><strong>{number.format(cycleHours)}</strong> / {number.format(intervalHours)} h</span>
      <div className="track" role="progressbar" aria-label="Avance del ciclo" aria-valuenow={Math.round(progress)}
        aria-valuetext={`${cycleHours} de ${intervalHours} horas`}>
        <i style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function EquipmentIdentity({ item }) {
  const { icon: Icon, detail } = typeDetails[item.type];
  return <>
    <span className={`type-icon ${item.type}`}><Icon size={19} /></span>
    <span><strong>{item.code}</strong><small>{item.typeName} · {detail}</small></span>
  </>;
}

function Sidebar({ view, onChange }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/mina.svg" width="41" height="41" alt="" />
        <div><strong>MinaControl</strong><span>GESTIÓN DE FLOTA</span></div>
      </div>
      <nav aria-label="Operaciones">
        <p className="nav-label">OPERACIONES</p>
        {views.map(({ id, title, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined}
            onClick={() => onChange(id)}><Icon size={18} /><span>{title}</span></button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <ShieldCheck size={20} />
        <div><strong>Entorno de demostración</strong><span>Operaciones mina · PE</span></div>
      </div>
    </aside>
  );
}

function Overview({ list, loading, onFilter }) {
  const count = Object.fromEntries(metrics.map(({ id }) => [id, id === 'all' ? list.length : list.filter((item) => item.status === id).length]));
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow"><span /> CONTROL DE FLOTA</span>
          <h2 id="hero-title">Cada hora cuenta.</h2>
          <p>Supervisa el uso de tu flota y programa el próximo servicio según el horómetro de cada equipo.</p>
          <button onClick={() => onFilter('due')}>Ver equipos que requieren servicio <ArrowRight size={16} /></button>
        </div>
        <img src="/hero-machine.svg" width="440" height="200" alt="" />
        <span className="hero-reference">FIG. 01 <b> / </b> FLOTA DE SUPERFICIE</span>
      </section>
      <div className="metrics" aria-label="Indicadores de la flota">
        {metrics.map(({ id, title, icon: Icon, caption }) => (
          <button className={`metric ${id}`} key={id} onClick={() => onFilter(id)}>
            <div className="metric-top"><span className="metric-icon"><Icon size={18} /></span><ArrowUpRight size={15} /></div>
            <div className="metric-number">{loading ? '–' : count[id]}</div>
            <strong>{title}</strong><span className="metric-caption">{caption}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function EquipmentTable({ items, types, filters, updateFilters, onOpen, loading, problem, retry, tableRef, view }) {
  const { search, type, status } = filters;
  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) =>
    (!query || `${item.code} ${item.typeName}`.toLowerCase().includes(query)) &&
    (!type || item.type === type) && (status === 'all' || item.status === status),
  );
  return (
    <section className="inventory" ref={tableRef} aria-labelledby="inventory-title">
      <div className="inventory-heading">
        <span className="panel-icon"><ClipboardList size={20} /></span>
        <div><h2 id="inventory-title">{view === 'maintenance' ? 'Ciclos de mantenimiento' : 'Inventario de equipos'}</h2>
          <p>{view === 'maintenance' ? 'Selecciona un equipo para consultar su historial o registrar un servicio.' : 'Consulta el horómetro y el estado de cada unidad.'}</p></div>
      </div>
      <div className="filters">
        <label className="search"><Search size={18} /><input value={search} placeholder="Buscar por código o tipo…" enterKeyHint="search"
          onChange={(event) => updateFilters({ search: event.target.value })} aria-label="Buscar por código o tipo" /></label>
        <label className="select"><select value={type} onChange={(event) => updateFilters({ type: event.target.value })} aria-label="Filtrar por tipo">
          <option value="">Todos los tipos</option>{types.map((entry) => <option value={entry.code} key={entry.code}>{entry.name}</option>)}
        </select><ChevronDown size={15} /></label>
        <label className="select"><select value={status} onChange={(event) => updateFilters({ status: event.target.value })} aria-label="Filtrar por estado">
          <option value="all">Estado: todos</option>{Object.entries(statusNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select><ChevronDown size={15} /></label>
      </div>
      {loading ? <p className="table-message" role="status">{usesRender
        ? 'Conectando con la API. Si estaba en reposo, puede tardar cerca de un minuto.'
        : 'Consultando equipos…'}</p> : problem ?
        <div className="table-message"><p role="alert">{problem}</p><button className="secondary" onClick={retry}>Reintentar</button></div> :
        filtered.length === 0 ? <div className="table-message"><Search size={22} /><strong>{items.length ? 'Sin coincidencias' : 'El inventario está vacío'}</strong>
          <p>{items.length ? 'Prueba con otro código o filtro.' : 'Registra un equipo para empezar a controlar sus horas.'}</p>
          {items.length > 0 && <button className="secondary" onClick={() => updateFilters({ search: '', type: '', status: 'all' })}>Limpiar filtros</button>}
        </div> :
        <>
        <ul className="equipment-cards" aria-label="Equipos del inventario">
          {filtered.map((item) => (
            <li key={item.id}>
              <button className="equipment-link" onClick={() => onOpen(item)}>
                <EquipmentIdentity item={item} /><ArrowRight size={17} aria-hidden="true" />
              </button>
              <Status status={item.status} />
              <div className="card-readings">
                <div><span>Horómetro</span><strong>{number.format(item.hours)} h</strong></div>
                <div><span>Ciclo de servicio</span><Cycle equipment={item} /></div>
              </div>
            </li>
          ))}
        </ul>
        <div className="table-scroll" tabIndex="0" role="region" aria-label="Tabla de equipos">
          <table>
            <thead><tr><th scope="col">Equipo</th><th scope="col">Horómetro</th><th scope="col">Ciclo de servicio</th>
              <th scope="col">Estado</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{filtered.map((item) => (
              <tr key={item.id}>
                <td><button className="equipment-link" onClick={() => onOpen(item)}>
                  <EquipmentIdentity item={item} />
                </button></td>
                <td className="hours">{number.format(item.hours)} <span>h</span></td>
                <td><Cycle equipment={item} /></td>
                <td><Status status={item.status} /></td>
                <td><button className="icon-button" aria-label={`Ver opciones de ${item.code}`} onClick={() => onOpen(item)}><Ellipsis size={20} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div></>}
      <div className="inventory-footer"><span>{!loading && !problem ? `Mostrando ${filtered.length} de ${items.length} equipos` : 'Inventario'}</span>
        <span><i /> Lecturas en horas</span></div>
    </section>
  );
}

function HistoryPanel({ id }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.history(id, controller.signal)
      .then((data) => setResult({ data }))
      .catch((error) => { if (!controller.signal.aborted) setResult({ error: error.message }); });
    return () => controller.abort();
  }, [id, attempt]);

  return <section className="history">
    <h3><History size={17} /> Historial de mantenimiento</h3>
    {!result ? <p role="status">Cargando historial…</p> : result.error ?
      <><p role="alert">{result.error}</p><button className="secondary" onClick={() => { setResult(null); setAttempt(attempt + 1); }}>Reintentar</button></> :
      result.data.length === 0 ? <p>Aún no hay servicios registrados para este equipo.</p> :
      <ol>{result.data.map((event) => <li key={event.id}>
        <span className="history-dot" /><div><strong>Servicio a las {number.format(event.hours)} h</strong>
          <time dateTime={event.performedAt}>{date.format(new Date(event.performedAt))}</time>
          {event.notes && <p>{event.notes}</p>}</div>
      </li>)}</ol>}
  </section>;
}

function EquipmentDialog({ mode, item, types, offline, onMode, onClose, onSave }) {
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const titles = { add: 'Nuevo equipo', edit: 'Editar equipo', detail: item?.code, service: 'Registrar mantenimiento', delete: 'Eliminar equipo' };

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  function change(next) {
    setProblem('');
    onMode(next);
  }

  async function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setProblem('');
    setBusy(true);
    try {
      await onSave(mode, item, values);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><div><span className="dialog-eyebrow">CONTROL DE FLOTA</span><h2 id="dialog-title">{titles[mode]}</h2></div>
      <button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Cerrar"><X size={22} /></button></div>
    {mode === 'detail' ? <div className="dialog-body">
      <div className="detail-top"><span>{item.typeName} · {number.format(item.hours)} h acumuladas</span><Status status={item.status} /></div>
      <div className="detail-cycle"><Cycle equipment={item} />
        <span>{item.remainingHours > 0 ? `Faltan ${number.format(item.remainingHours)} h para el siguiente servicio.` : 'Alcanzó el intervalo de mantenimiento.'}</span></div>
      {offline ? <p>El historial y las acciones de mantenimiento requieren conexión.</p> : <HistoryPanel key={item.id} id={item.id} />}
      {!offline && <div className="dialog-actions detail-actions"><button className="icon-button danger-text" onClick={() => change('delete')} aria-label="Eliminar equipo"><Trash2 size={18} /></button>
        <button className="secondary" onClick={() => change('edit')}><Pencil size={16} /> Editar</button>
        <button className="primary" onClick={() => change('service')}><Wrench size={16} /> Registrar servicio</button></div>}
    </div> : <form className="dialog-body" key={mode} onSubmit={submit}>
      {mode === 'add' || mode === 'edit' ? <>
        <label>Código del equipo<input autoFocus name="code" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          required minLength="2" maxLength="24" pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,23}" placeholder="Ej. CAM-103" defaultValue={item?.code} /></label>
        <label>Tipo de equipo<select name="type" required defaultValue={item?.type || ''}><option value="" disabled>Selecciona un tipo</option>
          {types.map(({ code, name, intervalHours }) => <option key={code} value={code}>{name} · servicio cada {intervalHours} h</option>)}</select></label>
        <label>Horómetro (horas)<input name="hours" type="number" inputMode="numeric" required min={item?.hours || 0} max="1000000" step="1" placeholder="0" defaultValue={item?.hours} /></label>
      </> : mode === 'service' ? <>
        <p>El servicio quedará registrado para <strong>{item.code}</strong> a las <strong>{number.format(item.hours)} h</strong>. Su nuevo ciclo empieza con esta lectura.</p>
        <label>Notas del servicio <span>(opcional)</span><textarea autoFocus name="notes" maxLength="500" rows="3" placeholder="Ej. Se revisó el sistema hidráulico." /></label>
      </> : <p><strong>{item.code}</strong> saldrá del inventario activo. El historial se conservará en la base de datos.</p>}
      {(problem || offline) && <p role="alert" className="form-error"><AlertCircle size={17} />{offline ? 'Conéctate para guardar cambios.' : problem}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={() => item ? change('detail') : onClose()}>Cancelar</button>
        <button type="submit" className={mode === 'delete' ? 'danger' : 'primary'} disabled={busy || offline}>{busy ? 'Guardando…' :
          mode === 'service' ? 'Confirmar servicio' : mode === 'delete' ? 'Eliminar equipo' : 'Guardar equipo'}</button></div>
    </form>}
  </dialog>;
}

function App() {
  const [view, setView] = useState(viewFromUrl);
  const [filters, setFilters] = useState(emptyFilters);
  const [inventory, setInventory] = useState({ items: [], types: [], loading: true, problem: '' });
  const [snapshotStored, setSnapshotStored] = useState(() => Boolean(readSnapshot()));
  const [attempt, setAttempt] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const table = useRef(null);
  const inventoryRevision = useRef(0);
  const item = inventory.items.find(({ id }) => id === modal?.id);
  const pwa = usePwa();
  const offline = Boolean(inventory.offlineAt);

  useEffect(() => {
    const controller = new AbortController();
    const revision = inventoryRevision.current;
    const current = () => !controller.signal.aborted && revision === inventoryRevision.current;
    const request = navigator.onLine
      ? loadInventory(controller.signal, !readSnapshot())
      : Promise.reject(new Error('No hay conexión para cargar el inventario.'));
    request
      .then(([items, types]) => {
        if (current()) setInventory({ items, types, savedAt: Date.now(), loading: false, problem: '' });
      })
      .catch((error) => {
        if (!current()) return;
        const stored = readSnapshot();
        setInventory((previous) => {
          const snapshot = (stored?.savedAt ?? 0) > (previous.savedAt ?? 0) ? stored : previous;
          return snapshot.savedAt
            ? { ...snapshot, loading: false, problem: '', offlineAt: snapshot.savedAt }
            : { items: [], types: [], loading: false, problem: error.message };
        });
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const refresh = () => setAttempt((previous) => previous + 1);
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    const onBack = () => {
      setView(viewFromUrl());
      setFilters(emptyFilters);
      setModal(null);
    };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('popstate', onBack);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('popstate', onBack);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  useEffect(() => {
    const { items, types, savedAt } = inventory;
    if (!savedAt) return;
    try {
      if ((readSnapshot()?.savedAt ?? 0) < savedAt) {
        localStorage.setItem(snapshotKey, JSON.stringify({ items, types, savedAt }));
      }
      setSnapshotStored(true);
    } catch {
      // The online experience works without a local snapshot.
    }
  }, [inventory]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4_000);
    return () => clearTimeout(timeout);
  }, [notice]);

  function selectView(next) {
    const url = new URL(window.location.href);
    const slug = views.find(({ id }) => id === next)?.slug;
    if (slug) url.searchParams.set('vista', slug);
    else url.searchParams.delete('vista');
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
    setView(next);
    setFilters(emptyFilters);
    window.scrollTo(0, 0);
  }

  function filterByStatus(status) {
    setFilters({ search: '', type: '', status });
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    table.current?.scrollIntoView({ behavior: motion ? 'auto' : 'smooth', block: 'start' });
  }

  async function save(mode, selected, values) {
    if (offline || !navigator.onLine) throw new Error('Conéctate para guardar cambios.');
    let result;
    try {
      if (mode === 'delete') {
        await api.remove(selected.id);
      } else if (mode === 'service') {
        ({ equipment: result } = await api.maintain(selected.id, { notes: String(values.get('notes')) }));
      } else {
        const payload = { code: String(values.get('code')), type: String(values.get('type')), hours: Number(values.get('hours')) };
        result = mode === 'add' ? await api.create(payload) : await api.update(selected.id, payload);
      }
    } catch (error) {
      if (error instanceof ApiUnavailableError) setAttempt((previous) => previous + 1);
      throw error;
    }
    inventoryRevision.current += 1;
    const savedAt = Date.now();
    setInventory((current) => {
      const items = current.items.filter(({ id }) => id !== selected?.id);
      if (result) items.push(result);
      items.sort((a, b) => a.code.localeCompare(b.code));
      return { ...current, items, savedAt, offlineAt: current.offlineAt ? savedAt : undefined };
    });
    setNotice(mode === 'delete' ? 'Equipo eliminado del inventario.' : mode === 'service' ? 'Servicio registrado. Nuevo ciclo iniciado.' : 'Equipo guardado.');
    setModal(mode === 'service' ? { mode: 'detail', id: selected.id } : null);
  }

  const heading = view === 'overview' ? 'Resumen de operaciones' : views.find(({ id }) => id === view).title;
  const apiState = offline ? 'Modo lectura' : inventory.loading ? 'Conectando' : inventory.problem ? 'API sin conexión' : 'API conectada';
  return (
    <div className="app-shell">
      <Sidebar view={view} onChange={selectView} />
      <div className="workspace">
        <header className="topbar">
          <span><Activity size={17} /> <strong>Centro de operaciones</strong><b>/</b>{views.find(({ id }) => id === view).title}</span>
          <span className={`connection ${inventory.problem || offline ? 'offline' : ''}`}><i />{apiState}</span>
        </header>
        <main>
          <div className="page-heading"><div><span className="section-label"><Gauge size={14} /> MONITOREO DE ACTIVOS</span>
            <h1>{heading}</h1><p>Gestiona el inventario y el mantenimiento de tu flota minera.</p></div>
            <div className="page-actions"><InstallApp offlineReady={pwa.ready && snapshotStored} />
              <button className="primary add-button" disabled={offline || inventory.loading || Boolean(inventory.problem)} onClick={() => setModal({ mode: 'add' })}><Plus size={19} /> Nuevo equipo</button>
            </div>
          </div>
          {offline && <div className="app-banner" role="status"><div><strong>Inventario sin conexión</strong><p>Última copia guardada el {date.format(inventory.offlineAt)}.</p></div>
            <button className="secondary" onClick={() => setAttempt((previous) => previous + 1)}>Reconectar</button></div>}
          {pwa.update && !modal && !offline && <div className="app-banner"><div><strong>Actualización disponible</strong><p>Instala la nueva versión de MinaControl.</p></div>
            <button className="secondary" disabled={pwa.updating} onClick={pwa.update}>{pwa.updating ? 'Actualizando…' : 'Actualizar'}</button></div>}
          {view === 'overview' && <Overview list={inventory.items} loading={inventory.loading || Boolean(inventory.problem)} onFilter={filterByStatus} />}
          <EquipmentTable items={inventory.items} types={inventory.types} filters={filters}
            updateFilters={(changes) => setFilters((current) => ({ ...current, ...changes }))}
            onOpen={(entry) => setModal({ mode: 'detail', id: entry.id })} loading={inventory.loading}
            problem={inventory.problem} retry={() => { setInventory((current) => ({ ...current, loading: true, problem: '' })); setAttempt(attempt + 1); }}
            tableRef={table} view={view} />
          <footer className="page-footer">
            <span>MinaControl</span>
            <a href={apiDocsUrl} target="_blank" rel="noopener">API · Swagger <ArrowUpRight size={13} /></a>
          </footer>
        </main>
      </div>
      {modal && (modal.mode === 'add' || item) && <EquipmentDialog mode={modal.mode} item={item} types={inventory.types} offline={offline || Boolean(inventory.problem)} onMode={(mode) => setModal({ ...modal, mode })}
        onClose={() => setModal(null)} onSave={save} />}
      <div className="toast-region" aria-live="polite">{notice && <span className="toast"><CircleCheck size={19} />{notice}</span>}</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
