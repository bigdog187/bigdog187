import { aroflo } from './aroflo.js';

// Single source of truth for the data feeds used by widgets, the snapshot
// routine type, and scripts. Each value is a function returning the data.
export const SOURCES = {
  metrics: () => aroflo.metrics(),
  jobs: () => aroflo.jobs(),
  clients: () => aroflo.clients(),
  invoices: () => aroflo.invoices(),
  schedule: () => aroflo.schedule(),
  timesheets: () => aroflo.timesheets(),
  // Aggregations for chart widgets
  jobsByStatus: () => aroflo.jobsByStatus(),
  revenueByClient: () => aroflo.revenueByClient(),
  hoursByStaff: () => aroflo.hoursByStaff(),
  invoicesByStatus: () => aroflo.invoicesByStatus(),
};
