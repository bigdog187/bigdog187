import { aroflo } from './aroflo.js';
import { dashboardStore } from './dashboard-store.js';

/**
 * Tools Claude can call. Each has a JSON schema (sent to the model) and a
 * `run` function (executed on the server). To give Claude a new capability,
 * add an entry here — nothing else needs to change.
 */
export const tools = {
  get_metrics: {
    schema: {
      name: 'get_metrics',
      description:
        'Get the top-level business metrics: open jobs, overdue jobs, unpaid invoices, total outstanding dollars, hours logged this week, active clients.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => aroflo.metrics(),
  },

  list_jobs: {
    schema: {
      name: 'list_jobs',
      description:
        'List jobs/tasks. Optionally filter by status (e.g. "In Progress", "Scheduled", "Completed", "Awaiting Parts").',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Status to filter by (optional).' },
        },
      },
    },
    run: (input) => aroflo.jobs({ status: input.status }),
  },

  list_clients: {
    schema: {
      name: 'list_clients',
      description: 'List clients with contact details, open job counts, and year-to-date value.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => aroflo.clients(),
  },

  list_invoices: {
    schema: {
      name: 'list_invoices',
      description: 'List invoices. Optionally filter by status (e.g. "Paid", "Sent", "Overdue").',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Status to filter by (optional).' },
        },
      },
    },
    run: (input) => aroflo.invoices({ status: input.status }),
  },

  get_schedule: {
    schema: {
      name: 'get_schedule',
      description: "Get today's job schedule (time, staff member, job, client).",
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD (optional, defaults to today).' },
        },
      },
    },
    run: (input) => aroflo.schedule({ date: input.date }),
  },

  list_timesheets: {
    schema: {
      name: 'list_timesheets',
      description: 'List timesheet entries (staff, date, job, hours).',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => aroflo.timesheets(),
  },

  // ── Dashboard-shaping tools — let Claude change what's on screen ──
  add_widget: {
    schema: {
      name: 'add_widget',
      description:
        'Add a widget to the dashboard. Use "metric" for a single number (set source="metrics" and a field like openJobs, overdueJobs, unpaidInvoices, unpaidTotal, hoursThisWeek, activeClients). Use "table" for a list (set source to jobs|clients|invoices|schedule|timesheets and choose columns).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['metric', 'table'] },
          title: { type: 'string' },
          source: {
            type: 'string',
            enum: ['metrics', 'jobs', 'clients', 'invoices', 'schedule', 'timesheets'],
          },
          field: { type: 'string', description: 'For metric widgets: which metric field to show.' },
          columns: { type: 'array', items: { type: 'string' }, description: 'For table widgets.' },
          format: { type: 'string', enum: ['money', 'number'], description: 'Optional metric format.' },
          tone: { type: 'string', enum: ['default', 'warn'], description: 'Optional emphasis colour.' },
        },
        required: ['type', 'title', 'source'],
      },
    },
    run: (input) => {
      const w = dashboardStore.addWidget(input);
      return { added: w };
    },
  },

  remove_widget: {
    schema: {
      name: 'remove_widget',
      description: 'Remove a widget from the dashboard by its id (ids come from get_dashboard).',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    run: (input) => ({ removed: dashboardStore.removeWidget(input.id) }),
  },

  get_dashboard: {
    schema: {
      name: 'get_dashboard',
      description: 'Get the current dashboard layout (all widgets and their ids).',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => dashboardStore.get(),
  },
};

export function toolSchemas() {
  return Object.values(tools).map((t) => t.schema);
}

export async function runTool(name, input) {
  const tool = tools[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run(input || {});
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

// Tools that change the dashboard — the server tells the browser to refresh
// the grid when one of these runs.
export const DASHBOARD_MUTATING_TOOLS = new Set(['add_widget', 'remove_widget']);
