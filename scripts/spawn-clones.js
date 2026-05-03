import crypto from 'node:crypto';

/**
 * Tab Limit Test Script
 * 
 * Spawns 2100 clones of the "Now" tab with random authorIDs to test
 * the global database tab limit (currently 2048).
 */

const TARGET_URL = process.argv[2] || 'https://bg.ps.ai';
const CLONE_ENDPOINT = `${TARGET_URL}/api/tabs`; // Using the base tabs endpoint for PUT /id

const TOTAL_CLONES = 1000;
const CONCURRENCY = 20; // Number of simultaneous requests

function generateRandomId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

async function spawnClone(index) {
  const authorId = generateRandomId('user-');
  const tabId = generateRandomId('test-');
  const tabName = `Load Test ${index}`;

  // Payload with unique data to ensure it's "dirty" and hits the DB
  const payload = {
    tab: {
      id: tabId,
      name: tabName,
      layout: {
        unit: 'in',
        tools: [
          {
            id: generateRandomId('tool-'),
            name: 'Test Tool',
            x: Math.floor(Math.random() * 100),
            y: Math.floor(Math.random() * 100),
            width: 10,
            height: 10,
            rotation: 0,
            color: '#ff0000'
          }
        ]
      }
    }
  };

  try {
    const response = await fetch(`${CLONE_ENDPOINT}/${tabId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Author-Id': authorId
      },
      body: JSON.stringify(payload.tab) // API [id].ts expects the tab object directly, not wrapped in {tab: ...}
    });

    if (response.ok) {
      console.log(`[${index}/${TOTAL_CLONES}] ✅ Success: ${tabId} (Author: ${authorId})`);
      return { success: true };
    } else {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error(`[${index}/${TOTAL_CLONES}] ❌ Failed (${response.status}): ${errorData.error}`);
      return { success: false, status: response.status, error: errorData.error };
    }
  } catch (error) {
    console.error(`[${index}/${TOTAL_CLONES}] 💥 Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function run() {
  console.log(`\x1b[36m🚀 Starting Tab Limit Test\x1b[0m`);
  console.log(`\x1b[33mTarget:\x1b[0m ${TARGET_URL}`);
  console.log(`\x1b[33mCount:\x1b[0m  ${TOTAL_CLONES} clones`);
  console.log(`\x1b[33mMode:\x1b[0m   Random AuthorIDs (tests global limit)\n`);

  const results = {
    success: 0,
    failed: 0,
    statusCodes: {}
  };

  const queue = Array.from({ length: TOTAL_CLONES }, (_, i) => i + 1);
  const startTime = Date.now();

  async function worker() {
    while (queue.length > 0) {
      const index = queue.shift();
      const res = await spawnClone(index);

      if (res.success) {
        results.success++;
      } else {
        results.failed++;
        const status = res.status || 'network-error';
        results.statusCodes[status] = (results.statusCodes[status] || 0) + 1;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n\x1b[36m--- Test Summary ---\x1b[0m`);
  console.log(`⏱️  Duration:   ${duration}s`);
  console.log(`✅ Successful: ${results.success}`);
  console.log(`❌ Failed:     ${results.failed}`);

  if (Object.keys(results.statusCodes).length > 0) {
    console.log(`\n\x1b[33m--- Status Breakdown ---\x1b[0m`);
    Object.entries(results.statusCodes).forEach(([status, count]) => {
      console.log(`[${status}]: ${count}`);
    });
  }

  if (results.statusCodes['429']) {
    console.log(`\n\x1b[32m💡 Hint: Status 429 indicates the tab limit was successfully hit!\x1b[0m`);
  }
}

run().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
