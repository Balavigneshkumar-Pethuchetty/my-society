import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, IconButton,
  Paper, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import MenuIcon from '@mui/icons-material/Menu';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import BusinessIcon from '@mui/icons-material/Business';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { AdminSidebar } from '../components/AdminSidebar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HierarchyLevel {
  level_index: number;
  level_name: string;
  is_billable: boolean;
}

interface StructureNode {
  id: string;
  name: string;
  level_index: number;
  level_name: string;
  parent_id: string | null;
  created_at: string;
}

interface TreeNode extends StructureNode {
  children: TreeNode[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

function apiBase() {
  const isLocalDevHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalDevHost && ['4004', '4005'].includes(window.location.port)) return `${window.location.origin}/api/users`;
  return '/api/users';
}

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const getHierarchy   = (t: string) => apiFetch<HierarchyLevel[]>('/building/hierarchy', t);
const setHierarchy   = (t: string, levels: HierarchyLevel[]) =>
  apiFetch<{ ok: boolean }>('/building/hierarchy', t, { method: 'PUT', body: JSON.stringify({ levels }) });
const getNodes       = (t: string) => apiFetch<StructureNode[]>('/building/nodes', t);
const createNode     = (t: string, name: string, level_index: number, parent_id: string | null) =>
  apiFetch<StructureNode>('/building/nodes', t, {
    method: 'POST', body: JSON.stringify({ name, level_index, parent_id }),
  });
const deleteNode     = (t: string, id: string) =>
  apiFetch<void>(`/building/nodes/${id}`, t, { method: 'DELETE' });
const importRows     = (t: string, rows: string[][]) =>
  apiFetch<{ added: number }>('/building/nodes/import-rows', t, {
    method: 'POST', body: JSON.stringify({ rows }),
  });

// ── Tree builder ──────────────────────────────────────────────────────────────

function buildTree(nodes: StructureNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  nodes.forEach(n => map.set(n.id, { ...n, children: [] }));
  const roots: TreeNode[] = [];
  nodes.forEach(n => {
    const node = map.get(n.id)!;
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // Sort children by name
  const sortChildren = (t: TreeNode) => {
    t.children.sort((a, b) => a.name.localeCompare(b.name));
    t.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortChildren);
  return roots;
}

// ── CSV / Excel helpers ───────────────────────────────────────────────────────

function collectLeafPaths(tree: TreeNode[], maxLevels: number): string[][] {
  const paths: string[][] = [];
  function traverse(node: TreeNode, path: string[]) {
    const newPath = [...path, node.name];
    if (node.children.length === 0 || newPath.length === maxLevels) {
      paths.push(newPath);
    } else {
      node.children.forEach(c => traverse(c, newPath));
    }
  }
  tree.forEach(r => traverse(r, []));
  return paths;
}

function downloadCSV(headers: string[], rows: string[][], filename: string) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportAsXlsx(headers: string[], rows: string[][], filename: string) {
  try {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Building Structure');
    XLSX.writeFile(wb, filename);
  } catch {
    // xlsx not installed — fall back to CSV with .xlsx extension
    downloadCSV(headers, rows, filename);
  }
}

function parseCSVText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    const row: string[] = [];
    let inQuote = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuote) { inQuote = true; continue; }
      if (ch === '"' && inQuote) {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuote = false; }
        continue;
      }
      if (ch === ',' && !inQuote) { row.push(cur); cur = ''; continue; }
      cur += ch;
    }
    row.push(cur);
    return row;
  });
}

async function parseFileToRows(file: File): Promise<string[][]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
      return data.slice(1).filter(r => r.some(c => c));
    } catch {
      throw new Error('xlsx library not available. Please import a CSV file instead.');
    }
  }
  const text = await file.text();
  const rows = parseCSVText(text);
  return rows.slice(1).filter(r => r.some(c => c.trim()));
}

// ── Tree node component ───────────────────────────────────────────────────────

function TreeItem({
  node, depth, selectedId, expandedIds,
  onSelect, onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const isSelected = node.id === selectedId;
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <Box
        onClick={() => onSelect(node.id)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          px: 1.5, py: 0.75,
          pl: 1.5 + depth * 2.5,
          cursor: 'pointer',
          bgcolor: isSelected ? '#6366f1' : 'transparent',
          color: isSelected ? '#fff' : 'text.primary',
          borderRadius: 0,
          transition: 'background .12s',
          '&:hover': { bgcolor: isSelected ? '#6366f1' : 'action.hover' },
        }}
      >
        {/* Expand/collapse toggle */}
        <Box
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(node.id); }}
          sx={{ display: 'flex', alignItems: 'center', width: 20, flexShrink: 0, color: isSelected ? '#c7d2fe' : 'text.secondary' }}
        >
          {hasChildren
            ? (isExpanded ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />)
            : null}
        </Box>

        <BusinessIcon sx={{ fontSize: 15, flexShrink: 0, opacity: 0.7 }} />

        <Typography fontSize={13} fontWeight={isSelected ? 700 : 400} sx={{ flex: 1, minWidth: 0 }} noWrap>
          {node.name}
        </Typography>

        <Box sx={{
          fontSize: 11, px: 0.75, py: 0.2, borderRadius: 1,
          bgcolor: isSelected ? 'rgba(255,255,255,.2)' : 'action.selected',
          color: isSelected ? '#e0e7ff' : 'text.secondary',
          flexShrink: 0,
        }}>
          {node.level_name}
        </Box>
      </Box>

      {isExpanded && node.children.map(child => (
        <TreeItem
          key={child.id} node={child} depth={depth + 1}
          selectedId={selectedId} expandedIds={expandedIds}
          onSelect={onSelect} onToggle={onToggle}
        />
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface BuildingStructureProps {
  token?: string | null;
}

export function BuildingStructure({ token = null }: BuildingStructureProps) {
  const { t } = useTranslation('admin');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);

  // ── Step 0: hierarchy config ──────────────────────────────────────────────
  const [numLevels, setNumLevels] = useState(4);
  const [levelNames, setLevelNames] = useState<string[]>(['Tower', 'Wing', 'Floor', 'Flat']);
  const [hierLoading, setHierLoading] = useState(true);
  const [hierSaving, setHierSaving] = useState(false);
  const [hierError, setHierError] = useState<string | null>(null);

  // ── Step 1: structure builder ─────────────────────────────────────────────
  const [nodes, setNodes] = useState<StructureNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newNodeName, setNewNodeName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StructureNode | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load existing hierarchy on mount ─────────────────────────────────────
  useEffect(() => {
    if (!token) { setHierLoading(false); return; }
    getHierarchy(token)
      .then(levels => {
        if (levels.length > 0) {
          setNumLevels(levels.length);
          setLevelNames(levels.map(l => l.level_name));
        }
      })
      .catch(() => {})
      .finally(() => setHierLoading(false));
  }, [token]);

  // Keep levelNames array length in sync with numLevels
  useEffect(() => {
    setLevelNames(prev => {
      if (prev.length === numLevels) return prev;
      if (prev.length < numLevels) {
        const defaults = ['Tower', 'Wing', 'Floor', 'Flat', 'Unit', 'Sub-Unit'];
        return [...prev, ...defaults.slice(prev.length, numLevels)];
      }
      return prev.slice(0, numLevels);
    });
  }, [numLevels]);

  // ── Load nodes ────────────────────────────────────────────────────────────
  const loadNodes = useCallback(async () => {
    if (!token) return;
    setNodesLoading(true);
    try {
      const list = await getNodes(token);
      setNodes(list);
    } catch (e) {
      /* silently fail — page still usable */
    } finally {
      setNodesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (step === 1) loadNodes();
  }, [step, loadNodes]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const selectedNode = useMemo(
    () => (selectedId ? nodes.find(n => n.id === selectedId) ?? null : null),
    [selectedId, nodes],
  );

  const levels: HierarchyLevel[] = useMemo(
    () => levelNames.map((name, i) => ({
      level_index: i + 1,
      level_name: name,
      is_billable: i + 1 === numLevels,
    })),
    [levelNames, numLevels],
  );

  const maxLevelIndex = numLevels;

  // For the Add Node panel:
  // - root if no node selected (adds level 1 root node)
  // - child of selectedNode (adds level selectedNode.level_index + 1)
  // - can't add if selectedNode is at max depth
  const addingToLevel = selectedNode
    ? selectedNode.level_index + 1
    : 1;
  const addingToLevelName = levelNames[addingToLevel - 1] ?? 'Node';
  const addingToParentId = selectedNode?.id ?? null;
  const isAtDeepest = selectedNode !== null && selectedNode.level_index >= maxLevelIndex;

  // ── Handlers: step 0 ─────────────────────────────────────────────────────
  const handleNextStep = async () => {
    if (!token) return;
    setHierSaving(true);
    setHierError(null);
    try {
      await setHierarchy(token, levels);
      setStep(1);
    } catch (e) {
      setHierError((e as Error).message);
    } finally {
      setHierSaving(false);
    }
  };

  // ── Handlers: step 1 ─────────────────────────────────────────────────────
  const handleSelectNode = (id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
    setAddError(null);
    setNewNodeName('');
  };

  const handleToggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const handleAddNode = async () => {
    if (!token || !newNodeName.trim()) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await createNode(token, newNodeName.trim(), addingToLevel, addingToParentId);
      setNodes(prev => [...prev, created]);
      setNewNodeName('');
      // Auto-expand parent
      if (addingToParentId) {
        setExpandedIds(prev => new Set([...prev, addingToParentId]));
      }
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!token || !deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteNode(token, deleteTarget.id);
      // Remove deleted node + all its descendants from state
      const deletedSet = new Set<string>();
      const markDeleted = (id: string) => {
        deletedSet.add(id);
        nodes.filter(n => n.parent_id === id).forEach(n => markDeleted(n.id));
      };
      markDeleted(deleteTarget.id);
      setNodes(prev => prev.filter(n => !deletedSet.has(n.id)));
      if (selectedId && deletedSet.has(selectedId)) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = '';
    setImportBusy(true);
    setImportMsg(null);
    setImportError(null);
    try {
      const rows = await parseFileToRows(file);
      const result = await importRows(token, rows);
      setImportMsg(t('buildingStructure.step1.importCompleted', { count: result.added }));
      await loadNodes();
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const handleSampleCSV = () => {
    const headers = levelNames;
    const sampleRow1 = levelNames.map((n, i) => `${n} A${i === levelNames.length - 1 ? '1' : ''}`);
    const sampleRow2 = levelNames.map((n, i) => `${n} A${i === levelNames.length - 1 ? '2' : ''}`);
    downloadCSV(headers, [sampleRow1, sampleRow2], 'sample-building-structure.csv');
  };

  const handleSampleExcel = async () => {
    const headers = levelNames;
    const sampleRow1 = levelNames.map((n, i) => `${n} A${i === levelNames.length - 1 ? '1' : ''}`);
    const sampleRow2 = levelNames.map((n, i) => `${n} A${i === levelNames.length - 1 ? '2' : ''}`);
    await exportAsXlsx(headers, [sampleRow1, sampleRow2], 'sample-building-structure.xlsx');
  };

  const handleExportCSV = () => {
    const headers = levelNames;
    const paths = collectLeafPaths(tree, maxLevelIndex);
    downloadCSV(headers, paths, 'building-structure.csv');
  };

  const handleExportExcel = async () => {
    const headers = levelNames;
    const paths = collectLeafPaths(tree, maxLevelIndex);
    await exportAsXlsx(headers, paths, 'building-structure.xlsx');
  };

  const handleSaveAndContinue = () => {
    // Step 1: every node add/delete is already persisted immediately.
    // Calling setHierarchy here would CASCADE-delete all structure_nodes.
    // Just acknowledge that the structure is saved.
    setSaveMsg(t('buildingStructure.step1.savedMsg'));
  };

  // ── Render: step 0 ────────────────────────────────────────────────────────
  if (hierLoading) {
    return (
      <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
        <AdminSidebar active="Building" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (step === 0) {
    return (
      <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
        <AdminSidebar active="Building" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

        <Box sx={{ flex: 1, bgcolor: 'background.default', p: { xs: 2, md: 4 }, overflow: 'auto' }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
            <IconButton onClick={() => setSidebarOpen(true)} sx={{ display: { md: 'none' }, color: 'text.secondary' }}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ textAlign: 'center', flex: 1 }}>
              <Typography variant="h5" fontWeight={800} sx={{ fontSize: { xs: 22, md: 28 } }}>
                {t('buildingStructure.step0.title')}
              </Typography>
              <Typography color="text.secondary" fontSize={14} mt={0.5}>
                {t('buildingStructure.step0.subtitle')}
              </Typography>
            </Box>
          </Box>

          <Paper variant="outlined" sx={{ maxWidth: 540, mx: 'auto', p: { xs: 2.5, md: 4 } }}>
            {/* Hierarchy levels section */}
            <Typography fontWeight={700} fontSize={20} mb={0.5}>{t('buildingStructure.step0.hierarchyLevelsTitle')}</Typography>
            <Typography color="text.secondary" fontSize={13} mb={3}>
              {t('buildingStructure.step0.hierarchyLevelsSubtitle')}
            </Typography>

            {/* Number of levels */}
            <Typography fontWeight={600} fontSize={13} mb={1.5}>{t('buildingStructure.step0.numberOfLevels')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Button
                variant="outlined" onClick={() => setNumLevels(n => Math.max(1, n - 1))}
                sx={{ minWidth: 40, height: 36, borderColor: 'divider', color: 'text.secondary', fontSize: 20, fontWeight: 400, lineHeight: 1 }}>
                −
              </Button>
              <Typography fontWeight={700} fontSize={24} sx={{ minWidth: 28, textAlign: 'center' }}>
                {numLevels}
              </Typography>
              <Button
                variant="outlined" onClick={() => setNumLevels(n => Math.min(8, n + 1))}
                sx={{ minWidth: 40, height: 36, borderColor: 'divider', color: 'text.secondary', fontSize: 20, fontWeight: 400, lineHeight: 1 }}>
                +
              </Button>
            </Box>

            {/* Level name inputs */}
            {levelNames.map((name, i) => (
              <Box key={i} mb={2}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                  <Typography fontWeight={600} fontSize={13}>{t('buildingStructure.step0.levelNameLabel', { num: i + 1 })}</Typography>
                  {i + 1 === numLevels && (
                    <Box sx={{ fontSize: 11, px: 0.75, py: 0.2, borderRadius: 1,
                      bgcolor: '#e0e7ff', color: '#4338ca', fontWeight: 600 }}>
                      {t('buildingStructure.step0.leafNodeChip')}
                    </Box>
                  )}
                </Box>
                <TextField
                  fullWidth size="small" value={name} variant="outlined"
                  onChange={e => setLevelNames(prev => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })}
                />
              </Box>
            ))}

            {hierError && <Alert severity="error" sx={{ mt: 2 }}>{hierError}</Alert>}

            {/* Actions */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4, gap: 2 }}>
              <Button variant="outlined" disabled sx={{ color: 'text.secondary', borderColor: 'divider', px: 3 }}>
                {t('common.back')}
              </Button>
              <Button
                variant="contained" onClick={handleNextStep}
                disabled={hierSaving || levelNames.some(n => !n.trim())}
                startIcon={hierSaving ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, px: 3, fontWeight: 700 }}
              >
                {t('buildingStructure.step0.nextBtn')}
              </Button>
            </Box>
          </Paper>
        </Box>
      </Box>
    );
  }

  // ── Render: step 1 (Structure Builder) ───────────────────────────────────
  const rootLevelName = levelNames[0] ?? 'Node';

  return (
    <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <AdminSidebar active="Building" mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <Box sx={{ flex: 1, bgcolor: 'background.default', p: { xs: 2, md: 4 }, overflow: 'auto' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
          <IconButton onClick={() => setSidebarOpen(true)} sx={{ display: { md: 'none' }, color: 'text.secondary' }}>
            <MenuIcon />
          </IconButton>
          <Box sx={{ textAlign: 'center', flex: 1 }}>
            <Typography variant="h5" fontWeight={800} sx={{ fontSize: { xs: 22, md: 28 } }}>
              {t('buildingStructure.step1.title')}
            </Typography>
            <Typography color="text.secondary" fontSize={14} mt={0.5}>
              {t('buildingStructure.step1.subtitle')}
            </Typography>
          </Box>
        </Box>

        {/* Two-column layout */}
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', lg: 'row' } }}>

          {/* ── Left: Structure Tree ── */}
          <Paper variant="outlined" sx={{ flex: '0 0 340px', minWidth: 0, overflow: 'hidden',
            width: { xs: '100%', lg: 340 } }}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={700} fontSize={18}>{t('buildingStructure.step1.treeTitle')}</Typography>
              <Typography color="text.secondary" fontSize={12} mt={0.25}>
                {t('buildingStructure.step1.treeSubtitle')}
              </Typography>
            </Box>

            {nodesLoading ? (
              <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
            ) : tree.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <BusinessIcon sx={{ fontSize: 40, color: '#cbd5e1', mb: 1 }} />
                <Typography color="text.secondary" fontSize={13}>
                  {t('buildingStructure.step1.noNodesMsg', { level: rootLevelName })}
                </Typography>
              </Box>
            ) : (
              <Box sx={{ py: 1, maxHeight: 520, overflowY: 'auto' }}>
                {tree.map(node => (
                  <TreeItem
                    key={node.id} node={node} depth={0}
                    selectedId={selectedId} expandedIds={expandedIds}
                    onSelect={handleSelectNode} onToggle={handleToggleExpand}
                  />
                ))}
              </Box>
            )}
          </Paper>

          {/* ── Right: panels ── */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.5, width: { xs: '100%' } }}>

            {/* Add Node panel */}
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography fontWeight={700} fontSize={18} mb={0.25}>{t('buildingStructure.step1.addNodeTitle')}</Typography>
              <Typography color="text.secondary" fontSize={12} mb={2}>
                {selectedNode
                  ? t('buildingStructure.step1.addingTo', { name: selectedNode.name })
                  : t('buildingStructure.step1.addingToRoot')}
              </Typography>

              {isAtDeepest ? (
                <Typography color="text.secondary" fontSize={13}>
                  {t('buildingStructure.step1.deepestLevelMsg', { level: addingToLevelName })}
                </Typography>
              ) : (
                <>
                  <TextField
                    fullWidth size="small" placeholder={t('buildingStructure.step1.enterNamePlaceholder', { level: addingToLevelName })}
                    value={newNodeName}
                    onChange={e => setNewNodeName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddNode(); }}
                    disabled={addBusy}
                    sx={{ mb: 1.5 }}
                    InputProps={{
                      startAdornment: (
                        <Typography fontSize={12} color="text.secondary" sx={{ mr: 1, whiteSpace: 'nowrap' }}>
                          {t('buildingStructure.step1.addingLabel', { level: addingToLevelName })}
                        </Typography>
                      ),
                    }}
                  />
                  {addError && <Alert severity="error" sx={{ mb: 1.5 }}>{addError}</Alert>}
                  <Button
                    fullWidth variant="contained" onClick={handleAddNode}
                    disabled={addBusy || !newNodeName.trim()}
                    startIcon={addBusy ? <CircularProgress size={14} color="inherit" /> : <AddIcon />}
                    sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, textTransform: 'none', fontWeight: 700 }}>
                    {t('buildingStructure.step1.addBtn', { level: addingToLevelName })}
                  </Button>
                </>
              )}
            </Paper>

            {/* Import / Export panel */}
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography fontWeight={700} fontSize={18} mb={0.25}>{t('buildingStructure.step1.importTitle')}</Typography>
              <Typography color="text.secondary" fontSize={12} mb={2}>
                {t('buildingStructure.step1.importSubtitle')}
              </Typography>

              <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
                <Button
                  fullWidth variant="outlined" startIcon={<DownloadIcon />}
                  onClick={handleSampleCSV}
                  sx={{ textTransform: 'none', borderColor: 'divider', color: 'text.secondary', fontSize: 13 }}>
                  {t('buildingStructure.step1.sampleCsv')}
                </Button>
                <Button
                  fullWidth variant="outlined" startIcon={<DownloadIcon />}
                  onClick={handleSampleExcel}
                  sx={{ textTransform: 'none', borderColor: 'divider', color: 'text.secondary', fontSize: 13 }}>
                  {t('buildingStructure.step1.sampleExcel')}
                </Button>
              </Box>

              <input
                ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden
                onChange={handleImportFile}
              />
              <Button
                fullWidth variant="contained" startIcon={importBusy ? <CircularProgress size={14} color="inherit" /> : <UploadIcon />}
                disabled={importBusy}
                onClick={() => fileRef.current?.click()}
                sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, textTransform: 'none', fontWeight: 700, mb: 1 }}>
                {t('buildingStructure.step1.importBtn')}
              </Button>

              {importMsg && (
                <Typography fontSize={13} color="#16a34a" fontWeight={600} mb={1}>{importMsg}</Typography>
              )}
              {importError && (
                <Alert severity="error" sx={{ mb: 1 }}>{importError}</Alert>
              )}

              <Typography color="text.secondary" fontSize={12} mb={1}>{t('buildingStructure.step1.downloadCurrentStructure')}</Typography>
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Button
                  fullWidth variant="outlined" startIcon={<DownloadIcon />}
                  onClick={handleExportCSV} disabled={nodes.length === 0}
                  sx={{ textTransform: 'none', borderColor: 'divider', color: 'text.secondary', fontSize: 13 }}>
                  {t('buildingStructure.step1.exportCsv')}
                </Button>
                <Button
                  fullWidth variant="outlined" startIcon={<DownloadIcon />}
                  onClick={handleExportExcel} disabled={nodes.length === 0}
                  sx={{ textTransform: 'none', borderColor: 'divider', color: 'text.secondary', fontSize: 13 }}>
                  {t('buildingStructure.step1.exportExcel')}
                </Button>
              </Box>
            </Paper>

            {/* Actions panel (only when a node is selected) */}
            {selectedNode && (
              <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Typography fontWeight={700} fontSize={18} mb={2}>{t('buildingStructure.step1.actionsTitle')}</Typography>
                <Button
                  fullWidth variant="contained" color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setDeleteTarget(selectedNode)}
                  sx={{ textTransform: 'none', fontWeight: 700, mb: 1 }}>
                  {t('buildingStructure.step1.deleteBtn', { name: selectedNode.name })}
                </Button>
                <Typography color="text.secondary" fontSize={12}>
                  {t('buildingStructure.step1.deleteHint')}
                </Typography>
              </Paper>
            )}

            {saveMsg && (
              <Alert severity={saveMsg.startsWith('Error') ? 'error' : 'success'} onClose={() => setSaveMsg(null)}>
                {saveMsg}
              </Alert>
            )}
          </Box>
        </Box>

        {/* Bottom actions */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button
            variant="outlined"
            onClick={() => { setStep(0); setSelectedId(null); }}
            sx={{ borderColor: 'divider', color: 'text.secondary', px: 3 }}>
            {t('common.back')}
          </Button>
          <Button
            variant="contained" onClick={handleSaveAndContinue}
            sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, px: 4, fontWeight: 700 }}>
            {t('buildingStructure.step1.saveBtn')}
          </Button>
        </Box>
      </Box>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#dc2626' }}>{t('buildingStructure.dialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('buildingStructure.dialog.body', { name: deleteTarget?.name ?? '', level: deleteTarget?.level_name ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} variant="outlined" size="small">{t('common.cancel')}</Button>
          <Button
            onClick={handleDeleteConfirm} variant="contained" color="error" size="small"
            disabled={deleteBusy}
            startIcon={deleteBusy ? <CircularProgress size={12} color="inherit" /> : <DeleteIcon />}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
