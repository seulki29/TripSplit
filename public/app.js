import { getSession } from './session.js';

function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] === 'sa' && parts[1]) {
    return { view: 'superadmin', params: {} };
  }

  if (parts[0] === 't' && parts[1]) {
    const slug = parts[1];
    if (parts[2] === 'admin') return { view: 'admin', params: { slug } };
    if (parts[2] === 'report') return { view: 'report', params: { slug } };
    if (!parts[2]) return { view: 'trip', params: { slug } };
  }

  return { view: 'notfound', params: {} };
}

async function mount() {
  const { view, params } = matchRoute(location.pathname);
  const root = document.getElementById('app');

  if (view === 'notfound') {
    root.innerHTML = '<div class="container center" style="padding:4rem 0"><h2>페이지를 찾을 수 없습니다</h2></div>';
    return;
  }

  if (view === 'superadmin') {
    const mod = await import('./views/superadmin.js');
    mod.mount(root, params);
    return;
  }

  if (view === 'admin') {
    const mod = await import('./views/admin.js');
    mod.mount(root, params);
    return;
  }

  if (view === 'report') {
    const mod = await import('./views/report.js');
    mod.mount(root, params);
    return;
  }

  // view === 'trip': show login if no matching session, otherwise the member view.
  const session = getSession();
  if (session && session.tripSlug === params.slug && (session.role === 'member' || session.role === 'admin')) {
    const mod = await import('./views/member.js');
    mod.mount(root, params);
  } else {
    const mod = await import('./views/login.js');
    mod.mount(root, params);
  }
}

// Errors here mean document/location aren't available (e.g. this module was
// imported from a Node test for its `matchRoute` export, not run in a browser) —
// swallow rather than surface as an unhandled rejection in either context.
mount().catch(() => {});

export { matchRoute };
