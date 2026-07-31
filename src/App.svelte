<script lang="ts">
  import { onMount } from 'svelte';
  import type { Issue } from './lib/types';

  const STORAGE_KEY = 'welcome-ticket-watchers-token';
  const OWNER = 'join';
  const REPO = 'WelcomeToFedora';

  let token = '';
  let state: 'open' | 'all' | 'closed' = 'open';
  let labels = '';
  let sinceDays = 14;

  let loading = false;
  let status = 'Paste a token, then load issues.';
  let statusKind: 'ok' | 'error' = 'ok';
  let debug = '';
  let issues: Issue[] = [];

  let showReminders = false;
  let reminderThresholdDays = 14;
  let reminderIssues: Issue[] = [];

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

  async function forgeFetch(path: string) {
    const url = `/forge${path}`;
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

  async function loadIssues() {
    if (!token.trim()) return setStatus('Token is required.', 'error');
      loading = true;
      setStatus('Loading issues...');
    reminderIssues = [];
    showReminders = false;
    try {
      const params = new URLSearchParams({
        state,
        limit: '100',
        page: '1'
      });
      if (labels.trim()) params.set('labels', labels.trim());
      const data = await forgeFetch(`/api/v1/repos/${OWNER}/${REPO}/issues?${params.toString()}`);
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.issues)
          ? data.issues
          : Array.isArray(data?.data)
            ? data.data
            : Object.values(data ?? {}).filter((v) => v && typeof v === 'object');
      debug = Array.isArray(data)
        ? `array(${data.length})`
        : (() => {
            const vals = Object.values(data ?? {});
            const sample = vals.length ? JSON.stringify(vals[0]).slice(0, 220) : '(none)';
            return `keys=${Object.keys(data ?? {}).join(', ') || '(none)'} rows=${rows.length} sample=${sample}`;
          })();
      issues = rows.map((it) => ({
        index: it.number,
        title: it.title,
        updated_at: it.updated_at,
        labels: it.labels ?? [],
        assignees: (it.assignees ?? []).map((a: any) => a.login).filter(Boolean),
        html_url: it.html_url
      }));
      setStatus(`Loaded ${issues.length} issue(s).`);
    } catch (e: any) {
      setStatus(e?.message ?? String(e), 'error');
      issues = [];
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

  onMount(loadToken);
</script>

<svelte:head>
  <title>Welcome Ticket Watchers</title>
</svelte:head>

<div class="shell">
  <header>
    <h1>Welcome Ticket Watchers</h1>
    <p>Pure Svelte UI. Token stays in your browser.</p>
  </header>

  <section class="panel controls">
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
    </div>

    <div class="buttons">
      <button on:click={loadIssues} disabled={loading}>Load issues</button>
      <button on:click={computeReminderCandidates} disabled={loading || issues.length === 0}>Show reminder candidates</button>
    </div>

    <div class:bad={statusKind === 'error'} class="status">{status}</div>
    <div class="meta">{debug}</div>
  </section>

  <section class="panel">
    <h2>Issues</h2>
    <div class="meta">Showing loaded issues from {OWNER}/{REPO} via local proxy</div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Title</th><th>Updated</th><th>Labels</th><th>Assignees</th>
          </tr>
        </thead>
        <tbody>
          {#each issues as issue}
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
      <h2>Reminder candidates</h2>
      <div class="meta">Issues not updated in the last {reminderThresholdDays} days — manually issue reminders for these.</div>
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
</div>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: #07111f; color: #eef3ff; }
  .shell { max-width: 1300px; margin: 0 auto; padding: 24px; }
  header { margin-bottom: 18px; }
  h1, h2, p { margin: 0 0 8px; }
  .panel { background: #0f1a2d; border: 1px solid #24314a; border-radius: 16px; padding: 16px; margin-bottom: 16px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
  label { display: grid; gap: 6px; font-size: 14px; color: #b8c4df; }
  input, select { background: #09111e; color: #eef3ff; border: 1px solid #2b3a55; border-radius: 10px; padding: 10px 12px; }
  .buttons { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  button { background: #5b8cff; color: #fff; border: 0; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
  .status { margin-top: 12px; color: #b8c4df; }
  .status.bad { color: #ffb4b4; }
  .meta { color: #98a7c7; margin-bottom: 10px; font-size: 13px; }
  .tablewrap { overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px; border-bottom: 1px solid #24314a; vertical-align: top; }
  a { color: #8fd1ff; }
  .mono { font-family: ui-monospace, SFMono-Regular, monospace; }
  .reminders { margin: 0; padding-left: 20px; }
  .reminders li { margin: 8px 0; display: grid; gap: 2px; }
  @media (max-width: 800px) { .grid2 { grid-template-columns: 1fr; } }
</style>
