import { getDatabase } from '../utils/database.js';
import { execStreamOnNode, execOnNode } from '../ssh/sshManager.js';

export async function datasetRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * GET /api/datasets
   * List all registered datasets with optional tag filtering
   */
  fastify.get('/', async (request, reply) => {
    const db = getDatabase();
    const { tag, owner, search } = request.query;

    let query = `
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tags
      FROM datasets d
      LEFT JOIN dataset_tags dt ON d.id = dt.dataset_id
      LEFT JOIN tags t ON dt.tag_id = t.id
    `;
    const conditions = [];
    const params = [];

    if (owner) { conditions.push(`d.owner = ?`); params.push(owner); }
    if (search) { conditions.push(`(d.name LIKE ? OR d.description LIKE ?)`); params.push(`%${search}%`, `%${search}%`); }
    if (tag) {
      query += ` WHERE d.id IN (SELECT dataset_id FROM dataset_tags dt2 JOIN tags t2 ON dt2.tag_id = t2.id WHERE t2.name = ?)`;
      params.unshift(tag);
    } else if (conditions.length) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` GROUP BY d.id ORDER BY d.created_at DESC`;

    const datasets = db.prepare(query).all(...params);
    return datasets.map(d => ({
      ...d,
      tags: d.tags ? d.tags.split(',').filter(Boolean) : []
    }));
  });

  /**
   * GET /api/datasets/tags
   * List all available tags
   */
  fastify.get('/tags', async (request, reply) => {
    const db = getDatabase();
    const tags = db.prepare(`
      SELECT t.*, COUNT(dt.dataset_id) as dataset_count
      FROM tags t
      LEFT JOIN dataset_tags dt ON t.id = dt.tag_id
      GROUP BY t.id
      ORDER BY dataset_count DESC, t.name
    `).all();
    return tags;
  });

  /**
   * POST /api/datasets
   * Register a new dataset
   */
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'path', 'nodeId'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          path: { type: 'string', minLength: 1 },
          nodeId: { type: 'string', enum: ['node1', 'node2'] },
          description: { type: 'string', maxLength: 10000 },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', maxLength: 5000 }
        }
      }
    }
  }, async (request, reply) => {
    const db = getDatabase();
    const { name, path, nodeId, description = '', tags = [], notes = '' } = request.body;
    const owner = request.user.username;

    // Verify path exists on the node
    let sizeBytes = 0;
    try {
      const sizeOut = await execOnNode(nodeId, `du -sb "${path}" 2>/dev/null | cut -f1`, 8000);
      sizeBytes = parseInt(sizeOut) || 0;
    } catch {
      // Path may not be accessible, continue anyway
    }

    const insert = db.prepare(`
      INSERT INTO datasets (name, path, node_id, owner, description, notes, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const result = insert.run(name, path, nodeId, owner, description, notes, sizeBytes);
    const datasetId = result.lastInsertRowid;

    // Add tags
    if (tags.length) {
      await addTagsToDataset(db, datasetId, tags);
    }

    const dataset = db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(datasetId);
    reply.status(201).send({ ...dataset, tags });
  });

  /**
   * PUT /api/datasets/:id
   * Update dataset metadata
   */
  fastify.put('/:id', async (request, reply) => {
    const db = getDatabase();
    const { id } = request.params;
    const { name, description, notes, tags } = request.body;
    const { username, isAdmin } = request.user;

    const dataset = db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(id);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });
    if (dataset.owner !== username && !isAdmin) {
      return reply.status(403).send({ error: 'Only the owner or admin can edit this dataset' });
    }

    db.prepare(`
      UPDATE datasets SET name=?, description=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name ?? dataset.name, description ?? dataset.description, notes ?? dataset.notes, id);

    if (tags) {
      db.prepare(`DELETE FROM dataset_tags WHERE dataset_id = ?`).run(id);
      await addTagsToDataset(db, id, tags);
    }

    return { success: true, id };
  });

  /**
   * DELETE /api/datasets/:id
   * Unregister a dataset (does NOT delete files)
   */
  fastify.delete('/:id', async (request, reply) => {
    const db = getDatabase();
    const { id } = request.params;
    const { username, isAdmin } = request.user;

    const dataset = db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(id);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });
    if (dataset.owner !== username && !isAdmin) {
      return reply.status(403).send({ error: 'Only the owner or admin can delete this dataset' });
    }

    db.prepare(`DELETE FROM dataset_tags WHERE dataset_id = ?`).run(id);
    db.prepare(`DELETE FROM datasets WHERE id = ?`).run(id);
    return { success: true, message: 'Dataset unregistered (files not deleted)' };
  });

  /**
   * POST /api/datasets/:id/sync
   * Sync dataset from its node to the other node via rsync over SSH
   * Uses Server-Sent Events (SSE) to stream progress
   */
  fastify.post('/:id/sync', async (request, reply) => {
    const db = getDatabase();
    const { id } = request.params;
    const { targetNodeId } = request.body || {};

    const dataset = db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(id);
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' });

    const sourceNode = dataset.node_id;
    const targetNode = targetNodeId || (sourceNode === 'node1' ? 'node2' : 'node1');

    if (sourceNode === targetNode) {
      return reply.status(400).send({ error: 'Source and target nodes must be different' });
    }

    // SSE response headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendEvent = (data) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const TARGET_HOSTS = { node1: 'dilab.ssghu.ac.kr', node2: 'dilab2.ssghu.ac.kr' };
    const targetHost = TARGET_HOSTS[targetNode];
    const sshUser = process.env.SSH_USER || 'monitor';

    // rsync over SSH with progress
    const rsyncCmd = [
      'rsync',
      '-avz',
      '--progress',
      '--stats',
      '-e', `"ssh -o StrictHostKeyChecking=no"`,
      `"${dataset.path}"`,
      `"${sshUser}@${targetHost}:${dataset.path}"`
    ].join(' ');

    sendEvent({ type: 'start', message: `Starting rsync from ${sourceNode} to ${targetNode}...`, dataset: dataset.name });

    let totalBytes = 0;
    let transferredBytes = 0;

    try {
      await execStreamOnNode(
        sourceNode,
        rsyncCmd,
        (chunk) => {
          // Parse rsync progress output
          const progressMatch = chunk.match(/(\d+)\s+(\d+)%\s+([\d.]+\w+\/s)\s+(\d+:\d+:\d+)/);
          if (progressMatch) {
            transferredBytes = parseInt(progressMatch[1]);
            const pct = parseInt(progressMatch[2]);
            const speed = progressMatch[3];
            const eta = progressMatch[4];
            sendEvent({ type: 'progress', pct, transferredBytes, speed, eta });
          }

          // Parse stats
          const totalMatch = chunk.match(/Total file size:\s+([\d,]+)/);
          if (totalMatch) {
            totalBytes = parseInt(totalMatch[1].replace(/,/g, ''));
          }

          sendEvent({ type: 'output', text: chunk.trim() });
        },
        (errChunk) => {
          sendEvent({ type: 'warning', text: errChunk.trim() });
        }
      );

      // Update dataset record to indicate it exists on target node too
      db.prepare(`
        INSERT OR IGNORE INTO datasets (name, path, node_id, owner, description, notes, size_bytes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(dataset.name + ` (synced to ${targetNode})`, dataset.path, targetNode,
             dataset.owner, dataset.description, dataset.notes, totalBytes || dataset.size_bytes);

      sendEvent({ type: 'complete', message: 'Sync completed successfully!', totalBytes });
    } catch (err) {
      sendEvent({ type: 'error', message: `Sync failed: ${err.message}` });
    } finally {
      reply.raw.end();
    }
  });
}

async function addTagsToDataset(db, datasetId, tagNames) {
  for (const tagName of tagNames) {
    if (!tagName?.trim()) continue;
    // Upsert tag
    db.prepare(`INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)`).run(
      tagName.trim(),
      TAG_COLORS[tagName] || generateTagColor(tagName)
    );
    const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(tagName.trim());
    if (tag) {
      db.prepare(`INSERT OR IGNORE INTO dataset_tags (dataset_id, tag_id) VALUES (?, ?)`).run(datasetId, tag.id);
    }
  }
}

const TAG_COLORS = {
  'Multimodal': '#6366f1',
  'Federated Learning': '#10b981',
  'PROMPT project': '#f59e0b',
  'Video - FFmpeg Processed': '#ef4444',
  'Privacy-Preserving ML': '#8b5cf6',
  'NLP': '#3b82f6',
  'Computer Vision': '#06b6d4',
  'Speech': '#84cc16',
  'Medical Imaging': '#f97316',
  'Benchmark': '#ec4899'
};

function generateTagColor(name) {
  let hash = 0;
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}
