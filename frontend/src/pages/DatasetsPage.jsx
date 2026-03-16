import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuthStore } from '../stores/authStore';
import { formatBytes, relativeTime } from '../utils/format';
import {
  Database, Plus, Tag, Search, ArrowRightLeft, Edit2, Trash2,
  FolderOpen, ChevronDown, X, Check, Loader, Server
} from 'lucide-react';

// ─── Tag Badge ─────────────────────────────────────────────────────────────────
function TagBadge({ tag, onRemove, onClick, size = 'md' }) {
  const color = tag.color || '#6366f1';
  return (
    <span
      onClick={onClick}
      className={`tag-badge cursor-pointer select-none transition-opacity hover:opacity-80
        ${size === 'sm' ? 'text-[10px] px-1.5' : 'text-xs px-2 py-0.5'}`}
      style={{
        backgroundColor: `${color}18`,
        color: color,
        borderColor: `${color}40`,
        border: '1px solid'
      }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          className="ml-1 hover:opacity-70">
          <X size={9} />
        </button>
      )}
    </span>
  );
}

// ─── Sync Progress Modal ────────────────────────────────────────────────────────
function SyncModal({ dataset, onClose }) {
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const targetNode = dataset.node_id === 'node1' ? 'node2' : 'node1';

  const startSync = () => {
    setStatus('running');
    setLog([]);
    setProgress(0);

    // SSE stream
    const evtSource = new EventSource(`/api/datasets/${dataset.id}/sync`);
    // We POST via fetch for the body, then consume SSE
    fetch(`/api/datasets/${dataset.id}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': api.defaults.headers.common['Authorization']
      },
      body: JSON.stringify({ targetNodeId: targetNode })
    }).then(async res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === 'progress') setProgress(msg.pct || 0);
            if (msg.type === 'complete') { setStatus('done'); setProgress(100); }
            if (msg.type === 'error') setStatus('error');
            if (msg.text || msg.message) {
              setLog(l => [...l, { type: msg.type, text: msg.text || msg.message }].slice(-100));
            }
          } catch {}
        }
      }
      if (status === 'running') setStatus('done');
    }).catch(err => {
      setLog(l => [...l, { type: 'error', text: err.message }]);
      setStatus('error');
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-xl">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={15} className="text-accent" />
            <span className="font-medium text-sm text-slate-200">Sync Dataset</span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-slate-300">
              <Server size={14} />
              <span className="font-mono">{dataset.node_id === 'node1' ? 'dilab' : 'dilab2'}</span>
            </div>
            <ArrowRightLeft size={14} className="text-accent" />
            <div className="flex items-center gap-2 text-slate-300">
              <Server size={14} />
              <span className="font-mono">{targetNode === 'node1' ? 'dilab' : 'dilab2'}</span>
            </div>
          </div>

          <div className="p-3 bg-surface-700/50 rounded-lg text-xs font-mono text-slate-400 break-all">
            {dataset.path}
          </div>

          {/* Progress */}
          {(status === 'running' || status === 'done') && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{status === 'done' ? 'Complete' : 'Syncing…'}</span>
                <span>{progress}%</span>
              </div>
              <div className="progress-bar h-2">
                <div className={`progress-fill h-full ${status === 'done' ? 'bg-success' : 'bg-accent'}`}
                  style={{ width: `${progress}%`, transition: 'width 0.3s ease' }} />
              </div>
            </div>
          )}

          {/* Log */}
          {log.length > 0 && (
            <div className="max-h-40 overflow-y-auto bg-surface-900 rounded-lg p-3 space-y-0.5">
              {log.map((entry, i) => (
                <div key={i} className={`text-[11px] font-mono leading-snug
                  ${entry.type === 'error' ? 'text-danger' :
                    entry.type === 'complete' ? 'text-success' :
                    entry.type === 'warning' ? 'text-warn' : 'text-slate-500'}`}>
                  {entry.text}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-ghost text-sm">
              {status === 'done' ? 'Close' : 'Cancel'}
            </button>
            {status === 'idle' && (
              <button onClick={startSync} className="btn-primary text-sm">
                <ArrowRightLeft size={13} />
                Start Sync (rsync)
              </button>
            )}
            {status === 'running' && (
              <button disabled className="btn-primary text-sm opacity-60 cursor-not-allowed">
                <Loader size={13} className="animate-spin" />
                Syncing…
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dataset Form ──────────────────────────────────────────────────────────────
function DatasetForm({ existing, allTags, onClose, onSave }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    path: existing?.path || '',
    nodeId: existing?.node_id || 'node1',
    description: existing?.description || '',
    tags: existing?.tags || []
  });
  const [tagInput, setTagInput] = useState('');

  const addTag = (tagName) => {
    if (!tagName.trim() || form.tags.includes(tagName.trim())) return;
    setForm(f => ({ ...f, tags: [...f.tags, tagName.trim()] }));
    setTagInput('');
  };

  const removeTag = (tag) => setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag.name) }));

  const suggestedTags = allTags?.filter(t =>
    !form.tags.includes(t.name) &&
    t.name.toLowerCase().includes(tagInput.toLowerCase())
  ) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="card-header flex-shrink-0">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-accent" />
            <span className="font-medium text-sm text-slate-200">
              {existing ? 'Edit Dataset' : 'Register Dataset'}
            </span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">Dataset Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. COCO 2017 Validation"
                className="w-full bg-surface-900 border border-white/8 rounded-lg px-3 py-2 text-sm text-slate-200
                           placeholder:text-slate-600 focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">Node *</label>
              <div className="flex gap-2">
                {['node1', 'node2'].map(n => (
                  <button key={n} onClick={() => setForm(f => ({ ...f, nodeId: n }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors
                      ${form.nodeId === n ? 'bg-accent/15 text-accent border-accent/30' : 'text-slate-500 border-white/8 hover:text-slate-300'}`}>
                    {n === 'node1' ? 'dilab (Node 1)' : 'dilab2 (Node 2)'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">Absolute Path *</label>
            <input value={form.path} onChange={e => setForm(f => ({ ...f, path: e.target.value }))}
              placeholder="/data/datasets/coco2017"
              className="w-full bg-surface-900 border border-white/8 rounded-lg px-3 py-2 text-sm font-mono text-slate-200
                         placeholder:text-slate-600 focus:outline-none focus:border-accent/50" />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map(tagName => {
                const tagObj = allTags?.find(t => t.name === tagName) || { name: tagName, color: '#6366f1' };
                return <TagBadge key={tagName} tag={tagObj} onRemove={removeTag} />;
              })}
            </div>
            <div className="relative">
              <Tag size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag(tagInput))}
                placeholder="Add tag…"
                className="w-full bg-surface-900 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-200
                           placeholder:text-slate-600 focus:outline-none focus:border-accent/50"
              />
            </div>
            {tagInput && suggestedTags.length > 0 && (
              <div className="mt-1 bg-surface-800 border border-white/8 rounded-lg overflow-hidden">
                {suggestedTags.slice(0, 6).map(tag => (
                  <button key={tag.id} onClick={() => addTag(tag.name)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 text-left">
                    <TagBadge tag={tag} size="sm" />
                  </button>
                ))}
              </div>
            )}
            {/* Quick-add default tags */}
            <div className="flex flex-wrap gap-1 mt-2">
              {allTags?.filter(t => !form.tags.includes(t.name)).slice(0, 6).map(tag => (
                <button key={tag.id} onClick={() => addTag(tag.name)}>
                  <TagBadge tag={tag} size="sm" />
                </button>
              ))}
            </div>
          </div>

          {/* Description (Markdown) */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">
              README / Description (Markdown)
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={6}
              placeholder="## Description&#10;&#10;Describe this dataset, its source, format, and usage notes..."
              className="w-full bg-surface-900 border border-white/8 rounded-lg px-3 py-2 text-xs font-mono text-slate-300
                         placeholder:text-slate-600 focus:outline-none focus:border-accent/50 resize-y"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end p-4 border-t border-white/5 flex-shrink-0">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name || !form.path}
            className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={13} />
            {existing ? 'Save Changes' : 'Register Dataset'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dataset Card ──────────────────────────────────────────────────────────────
function DatasetCard({ dataset, allTags, canEdit, onEdit, onDelete, onSync }) {
  const [expanded, setExpanded] = useState(false);
  const tagObjects = (dataset.tags || []).map(name =>
    allTags?.find(t => t.name === name) || { name, color: '#6366f1' }
  );

  return (
    <div className="card hover:border-white/10 transition-colors">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-slate-100 text-sm truncate">{dataset.name}</h3>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono
                ${dataset.node_id === 'node1' ? 'bg-accent/10 text-accent/80' : 'bg-indigo-400/10 text-indigo-400/80'}`}>
                {dataset.node_id === 'node1' ? 'dilab' : 'dilab2'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 font-mono truncate mb-2">{dataset.path}</div>
            <div className="flex flex-wrap gap-1">
              {tagObjects.map(tag => <TagBadge key={tag.name} tag={tag} size="sm" />)}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <div className="flex items-center gap-1">
              {canEdit && (
                <>
                  <button onClick={() => onSync(dataset)} className="btn-ghost p-1.5 text-slate-500" title="Sync to other node">
                    <ArrowRightLeft size={12} />
                  </button>
                  <button onClick={() => onEdit(dataset)} className="btn-ghost p-1.5 text-slate-500">
                    <Edit2 size={12} />
                  </button>
                  <button onClick={() => onDelete(dataset)} className="btn-ghost p-1.5 text-slate-500 hover:text-danger">
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-slate-400">{formatBytes(dataset.size_bytes)}</div>
              <div className="text-[10px] text-slate-600">{dataset.owner} · {relativeTime(dataset.created_at)}</div>
            </div>
          </div>
        </div>

        {dataset.description && (
          <>
            <button onClick={() => setExpanded(e => !e)}
              className="mt-3 flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-400">
              <ChevronDown size={11} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'Hide' : 'Show'} README
            </button>
            {expanded && (
              <div className="mt-3 pt-3 border-t border-white/5 prose prose-sm prose-invert max-w-none text-xs
                              prose-p:text-slate-400 prose-headings:text-slate-300 prose-code:text-accent prose-code:bg-surface-700 prose-code:px-1 prose-code:rounded">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{dataset.description}</ReactMarkdown>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Datasets Page ────────────────────────────────────────────────────────
export default function DatasetsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [nodeFilter, setNodeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editDataset, setEditDataset] = useState(null);
  const [syncDataset, setSyncDataset] = useState(null);

  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ['datasets', search, activeTag, nodeFilter],
    queryFn: () => api.get('/datasets', {
      params: {
        search: search || undefined,
        tag: activeTag || undefined,
        owner: nodeFilter === 'mine' ? user?.username : undefined
      }
    }).then(r => r.data)
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get('/datasets/tags').then(r => r.data)
  });

  const createMutation = useMutation({
    mutationFn: data => api.post('/datasets', data),
    onSuccess: () => {
      toast.success('Dataset registered');
      queryClient.invalidateQueries(['datasets']);
      setShowForm(false);
    },
    onError: err => toast.error(err.response?.data?.message || 'Failed to register')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/datasets/${id}`, data),
    onSuccess: () => {
      toast.success('Dataset updated');
      queryClient.invalidateQueries(['datasets']);
      setEditDataset(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/datasets/${id}`),
    onSuccess: () => {
      toast.success('Dataset unregistered');
      queryClient.invalidateQueries(['datasets']);
    }
  });

  const handleSave = (form) => {
    if (editDataset) {
      updateMutation.mutate({ id: editDataset.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleDelete = (dataset) => {
    if (confirm(`Unregister "${dataset.name}"? Files will NOT be deleted.`)) {
      deleteMutation.mutate(dataset.id);
    }
  };

  const canEditDataset = (dataset) => user?.isAdmin || dataset.owner === user?.username;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Database size={20} className="text-accent" />
            Dataset Hub
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {datasets.length} registered dataset{datasets.length !== 1 ? 's' : ''} · {allTags.length} tags
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
          <Plus size={14} />
          Register Dataset
        </button>
      </div>

      {/* Tag cloud */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveTag(null)}
          className={`tag-badge transition-opacity ${!activeTag ? 'opacity-100' : 'opacity-50 hover:opacity-80'}`}
          style={{ backgroundColor: 'rgba(148,163,184,0.1)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.2)' }}
        >
          All datasets
        </button>
        {allTags.map(tag => (
          <button key={tag.id} onClick={() => setActiveTag(activeTag === tag.name ? null : tag.name)}>
            <TagBadge
              tag={tag}
              size="sm"
              style={{ opacity: activeTag && activeTag !== tag.name ? 0.4 : 1 }}
            />
            {tag.dataset_count > 0 && (
              <span className="ml-1 text-[9px] text-slate-600">{tag.dataset_count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search datasets…"
            className="w-full bg-surface-800 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300
                       placeholder:text-slate-600 focus:outline-none focus:border-accent/50" />
        </div>
        <div className="flex rounded-lg overflow-hidden border border-white/8">
          {[{ id: 'all', label: 'All Nodes' }, { id: 'node1', label: 'dilab' }, { id: 'node2', label: 'dilab2' }, { id: 'mine', label: 'Mine' }].map(f => (
            <button key={f.id} onClick={() => setNodeFilter(f.id)}
              className={`px-3 py-1.5 text-xs transition-colors
                ${nodeFilter === f.id ? 'bg-white/8 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dataset Grid */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-600">
          <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-2" />
          Loading datasets…
        </div>
      ) : datasets.length === 0 ? (
        <div className="py-16 text-center">
          <Database size={36} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No datasets found</p>
          <button onClick={() => setShowForm(true)} className="mt-3 btn-primary text-sm">
            <Plus size={13} /> Register your first dataset
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {datasets.map(dataset => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              allTags={allTags}
              canEdit={canEditDataset(dataset)}
              onEdit={() => setEditDataset(dataset)}
              onDelete={handleDelete}
              onSync={setSyncDataset}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {(showForm || editDataset) && (
        <DatasetForm
          existing={editDataset}
          allTags={allTags}
          onClose={() => { setShowForm(false); setEditDataset(null); }}
          onSave={handleSave}
        />
      )}

      {syncDataset && (
        <SyncModal
          dataset={syncDataset}
          onClose={() => setSyncDataset(null)}
        />
      )}
    </div>
  );
}
