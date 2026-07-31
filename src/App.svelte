<script lang="ts">
  import { onMount } from 'svelte';
  import heroImage from './assets/hero.png';
  import type { Issue } from './lib/types';

  const STORAGE_KEY = 'welcome-ticket-watchers-token';
  const OWNER = 'join';
  const REPO = 'WelcomeToFedora';
  const PRODUCTION_FORGE_BASE_URL = 'https://forge.fedoraproject.org';
  const FORGE_BASE_URL = import.meta.env.PROD ? PRODUCTION_FORGE_BASE_URL : '/forge';

  let token = '';
  let state: 'open' | 'all' | 'closed' = 'open';
  let labels = '';
  let sinceDays = 14;
  let pageSize = 50;
  let currentPage = 1;

  let loading = false;
  let status = 'Paste a token, then load issues.';
  let statusKind: 'ok' | 'error' = 'ok';
  let debug = '';
  let issues: Issue[] = [];
  let totalIssues = 0;
  let totalPages = 1;
  let pageIssues: Issue[] = [];

  let showReminders = false;
  let reminderThresholdDays = 14;
  let reminderIssues: Issue[] = [];

  function toPositiveInt(value: unknown, fallback: number) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function setStatus(msg: string, kind: 'ok' | 'error' = 'ok') {
    status = msg;
    statusKind = kind;
  }

  function loadToken() {
    token = localStorage.getItem(STORAGE_KEY) ?? '';
  }

  function saveToken() {
    localStorage.setItem(STORAGE_KEY, token);
  }

  function buildForgeUrl(path: string) {
    const base = FORGE_BASE_URL.endsWith('/') ? FORGE_BASE_URL.slice(0, -1) : FORGE_BASE_URL;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  async function forgeFetch(path: string) {
    const url = buildForgeUrl(path);
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `token ${token.trim()}`
      }
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }

  function normalizeIssues(data: any) {
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.issues)
        ? data.issues
        : Array.isArray(data?.data)
          ? data.data
          : Object.values(data ?? {}).filter((v) => v && typeof v === 'object');

    return rows.map((it) => ({
      index: it.number,
      title: it.title,
      updated_at: it.updated_at,
      labels: it.labels ?? [],
      assignees: (it.assignees ?? []).map((a: any) => a.login).filter(Boolean),
      html_url: it.html_url
    }));
  }

  function updatePageSlice() {
    const safePageSize = Math.max(1, toPositiveInt(pageSize, 50));
    const safeTotalPages = Math.max(1, Math.ceil(issues.length / safePageSize));
    totalIssues = issues.length;
    totalPages = safeTotalPages;
    currentPage = Math.min(Math.max(1, currentPage), safeTotalPages);
    const start = (currentPage - 1) * safePageSize;
    pageIssues = issues.slice(start, start + safePageSize);
  }

  function goToPage(page: number) {
    currentPage = page;
    updatePageSlice();
  }

  async function loadIssues() {
    if (!token.trim()) return setStatus('Token is required.', 'error');
    loading = true;
    setStatus('Loading issues...');
    reminderIssues = [];
    showReminders = false;
    try {
      const apiPageSize = 50;
      const fetchedIssues: Issue[] = [];
      let page = 1;

      while (true) {
        const params = new URLSearchParams({
          state,
          limit: String(apiPageSize),
          page: String(page)
        });
        if (labels.trim()) params.set('labels', labels.trim());

        const data = await forgeFetch(`/api/v1/repos/${OWNER}/${REPO}/issues?${params.toString()}`);
        const pageRows = normalizeIssues(data);
        fetchedIssues.push(...pageRows);

        if (pageRows.length < apiPageSize) break;
        page += 1;
      }

      const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
      const recentCount = fetchedIssues.filter((it) => Date.parse(it.updated_at) >= cutoff).length;
      debug = `rows=${fetchedIssues.length} recent=${recentCount}`;
      issues = fetchedIssues;
      currentPage = 1;
      updatePageSlice();
      setStatus(`Loaded ${issues.length} issue(s); ${recentCount} updated in the last ${sinceDays} day(s).`);
    } catch (e: any) {
      setStatus(e?.message ?? String(e), 'error');
      issues = [];
      pageIssues = [];
      totalIssues = 0;
      totalPages = 1;
    } finally {
      loading = false;
    }
  }

  function computeReminderCandidates() {
    const cutoff = Date.now() - reminderThresholdDays * 24 * 60 * 60 * 1000;
    reminderIssues = issues.filter((it) => Date.parse(it.updated_at) < cutoff);
    showReminders = true;
    setStatus(`Found ${reminderIssues.length} reminder candidate(s).`);
  }

  function labelNames(issue: Issue) {
    return issue.labels.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
  }

  $: {
    const safePageSize = Math.max(1, toPositiveInt(pageSize, 50));
    totalIssues = issues.length;
    totalPages = Math.max(1, Math.ceil(issues.length / safePageSize));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * safePageSize;
    pageIssues = issues.slice(start, start + safePageSize);
  }

  onMount(loadToken);
</script>

<svelte:head>
  <title>Welcome Ticket Watchers</title>
</svelte:head>

<main class="shell">
  <section class="hero panel">
    <div class="hero-copy">
      <div class="eyebrow">Fedora-flavored issue watcher</div>
      <h1>Welcome Ticket Watchers</h1>
      <p>
        Load Forgejo issues, spot stale threads, and keep the follow-up list tidy without sending tokens to the server.
      </p>
      <div class="hero-stats">
        <div>
          <strong>{issues.length}</strong>
          <span>recent issues loaded</span>
        </div>
        <div>
            <strong>{pageSize}</strong>
            <span>tickets per page</span>
        </div>
        <div>
            <strong>{reminderIssues.length}</strong>
            <span>reminders queued</span>
        </div>
      </div>
    </div>

    <div class="hero-art" aria-hidden="true">
      <img src={heroImage} alt="" />
    </div>
  </section>

  <section class="panel controls">
    <div class="section-title">
      <div>
        <h2>Controls</h2>
        <p class="meta">For local dev, the app still uses the Vite proxy. Deployed builds should set a Forgejo base URL.</p>
      </div>
      <div class:bad={statusKind === 'error'} class="status">{status}</div>
    </div>

    <div class="grid2">
      <label>
        Forgejo token
        <input bind:value={token} type="password" on:input={saveToken} placeholder="paste token" />
      </label>
      <label>
        Issue state
        <select bind:value={state}>
          <option value="open">open</option>
          <option value="all">all</option>
          <option value="closed">closed</option>
        </select>
      </label>
      <label>
        Labels (optional)
        <input bind:value={labels} placeholder="leave blank to load all labels" />
      </label>
      <label>
        Recent window (days)
        <input bind:value={sinceDays} type="number" min="1" step="1" />
      </label>
      <label>
        Reminder threshold (days)
        <input bind:value={reminderThresholdDays} type="number" min="1" step="1" />
      </label>
      <label>
        Tickets per page
        <input bind:value={pageSize} type="number" min="10" step="10" />
      </label>
    </div>

    <div class="buttons">
      <button on:click={loadIssues} disabled={loading}>{loading ? 'Loading…' : 'Load issues'}</button>
      <button on:click={computeReminderCandidates} disabled={loading || issues.length === 0}>Show reminder candidates</button>
    </div>

    <div class="meta code-line">{debug}</div>
  </section>

  <section class="panel">
    <div class="section-title compact">
      <div>
        <h2>Issues</h2>
        <p class="meta">Showing page {currentPage} of {totalPages} from {totalIssues} loaded issues in {OWNER}/{REPO}.</p>
      </div>
      <div class="page-controls">
        <button on:click={() => goToPage(currentPage - 1)} disabled={loading || currentPage <= 1}>Previous</button>
        <button on:click={() => goToPage(currentPage + 1)} disabled={loading || currentPage >= totalPages}>Next</button>
      </div>
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Updated</th>
            <th>Labels</th>
            <th>Assignees</th>
          </tr>
        </thead>
        <tbody>
          {#each pageIssues as issue}
            <tr>
              <td class="mono">#{issue.index}</td>
              <td><a href={issue.html_url} target="_blank" rel="noreferrer">{issue.title}</a></td>
              <td class="mono">{issue.updated_at}</td>
              <td>{labelNames(issue).join(', ')}</td>
              <td>{issue.assignees.join(', ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if showReminders}
    <section class="panel">
      <div class="section-title compact">
        <div>
          <h2>Reminder candidates</h2>
          <p class="meta">Issues not updated in the last {reminderThresholdDays} days.</p>
        </div>
      </div>

      {#if reminderIssues.length === 0}
        <p>No reminder candidates.</p>
      {:else}
        <ul class="reminders">
          {#each reminderIssues as issue}
            <li>
              <a href={issue.html_url} target="_blank" rel="noreferrer">#{issue.index}</a>
              <span>{issue.title}</span>
              <small>{issue.updated_at}</small>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</main>

<style>
  .shell {
    max-width: 1240px;
    margin: 0 auto;
    padding: 24px 18px 44px;
    display: grid;
    gap: 20px;
  }

  .panel {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(36, 74, 180, 0.12);
    border-radius: 28px;
    box-shadow: 0 18px 45px rgba(25, 47, 104, 0.09);
    backdrop-filter: blur(12px);
  }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.85fr);
    gap: 18px;
    align-items: center;
    padding: 30px;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 12% 10%, rgba(164, 197, 255, 0.4), transparent 26%),
      radial-gradient(circle at 88% 20%, rgba(255, 255, 255, 0.28), transparent 18%),
      linear-gradient(135deg, #1d4ed8 0%, #2563eb 42%, #4f86ff 100%);
    border: 0;
    box-shadow: 0 22px 54px rgba(29, 78, 216, 0.22);
  }

  .hero::before,
  .hero::after {
    content: '';
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
    filter: blur(8px);
  }

  .hero::before {
    width: 240px;
    height: 240px;
    left: -70px;
    top: -110px;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.2), transparent 68%);
  }

  .hero::after {
    width: 340px;
    height: 340px;
    right: -140px;
    bottom: -180px;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.12), transparent 70%);
  }

  .hero-copy,
  .hero-art {
    position: relative;
    z-index: 1;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.72rem;
    margin-bottom: 12px;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: clamp(2.5rem, 6vw, 4.6rem);
    line-height: 0.95;
    letter-spacing: -0.05em;
    margin-bottom: 12px;
    color: white;
  }

  .hero-copy > p {
    max-width: 62ch;
    color: rgba(255, 255, 255, 0.9);
    font-size: 1.02rem;
    line-height: 1.6;
  }

  .hero-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 20px;
  }

  .hero-stats div {
    min-width: 140px;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(10px);
  }

  .hero-stats strong {
    display: block;
    font-size: 1.7rem;
    line-height: 1;
    color: white;
  }

  .hero-stats span {
    display: block;
    margin-top: 6px;
    color: rgba(255, 255, 255, 0.88);
    font-size: 0.9rem;
  }

  .hero-art {
    display: grid;
    place-items: center;
    min-height: 260px;
    padding: 20px;
  }

  .hero-art img {
    width: min(100%, 320px);
    height: auto;
    filter: drop-shadow(0 22px 32px rgba(10, 37, 99, 0.24));
    transform: rotate(-1deg);
    background: rgba(255, 255, 255, 0.82);
    border-radius: 28px;
    padding: 14px;
  }

  .controls,
  .panel:last-child {
    padding: 24px;
  }

  .section-title {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 18px;
  }

  .compact {
    margin-bottom: 10px;
  }

  .grid2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  label {
    display: grid;
    gap: 8px;
    color: #3f506f;
    font-size: 0.95rem;
  }

  input,
  select {
    border: 1px solid rgba(39, 89, 203, 0.18);
    border-radius: 14px;
    padding: 12px 14px;
    background: rgba(247, 250, 255, 0.96);
    color: #13213c;
    outline: none;
  }

  input:focus,
  select:focus {
    border-color: rgba(37, 99, 235, 0.72);
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14);
  }

  .buttons {
    display: flex;
    gap: 12px;
    margin-top: 16px;
    flex-wrap: wrap;
  }

  .page-controls {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  button {
    border: 0;
    border-radius: 999px;
    padding: 12px 18px;
    background: linear-gradient(135deg, #1d4ed8, #2563eb 55%, #4f86ff);
    color: white;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 12px 26px rgba(29, 78, 216, 0.22);
  }

  button:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .status {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    margin: 0;
    padding: 10px 14px;
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.08);
    color: #17325f;
    border: 1px solid rgba(37, 99, 235, 0.14);
    min-height: 1.5rem;
  }

  .status.bad {
    background: rgba(220, 38, 38, 0.08);
    border-color: rgba(220, 38, 38, 0.16);
    color: #a61d1d;
  }

  .meta {
    color: #62718d;
    font-size: 0.92rem;
  }

  .code-line {
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(243, 247, 255, 0.8);
    border: 1px solid rgba(32, 72, 174, 0.1);
    overflow-wrap: anywhere;
  }

  .tablewrap {
    overflow: auto;
    border-radius: 18px;
    border: 1px solid rgba(32, 72, 174, 0.1);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 760px;
  }

  thead {
    background: rgba(240, 245, 255, 0.98);
  }

  th,
  td {
    text-align: left;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(32, 72, 174, 0.08);
    vertical-align: top;
  }

  tbody tr:hover {
    background: rgba(37, 99, 235, 0.04);
  }

  a {
    color: var(--accent-link);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .mono {
    font-family: var(--mono);
    color: #51617d;
  }

  .reminders {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }

  .reminders li {
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(243, 247, 255, 0.9);
    border: 1px solid rgba(32, 72, 174, 0.08);
  }

  .reminders small {
    color: #62718d;
  }

  @media (max-width: 900px) {
    .hero {
      grid-template-columns: 1fr;
    }

    .grid2 {
      grid-template-columns: 1fr;
    }

    .section-title {
      flex-direction: column;
    }

    .status {
      justify-content: flex-start;
    }
  }
</style>
