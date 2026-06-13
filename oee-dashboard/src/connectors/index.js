import { SimulatorConnector } from './simulator.js';
import { AllenBradleyConnector } from './allenBradley.js';
import { ModbusConnector } from './modbus.js';

export const CONNECTOR_TYPES = {
  simulator: SimulatorConnector,
  'allen-bradley': AllenBradleyConnector,
  modbus: ModbusConnector,
};

export function createConnector(type, config) {
  const Cls = CONNECTOR_TYPES[type];
  if (!Cls) throw new Error(`Unknown connector type: ${type}`);
  return new Cls(config);
}

// Metadata used by the UI to render connection forms.
export const CONNECTOR_META = [
  {
    type: 'simulator',
    label: 'Simulator (demo)',
    description: 'Built-in simulated production line. No hardware required.',
    fields: [],
  },
  {
    type: 'allen-bradley',
    label: 'Allen Bradley (EtherNet/IP)',
    description: 'ControlLogix / CompactLogix / Micro800 over EtherNet/IP.',
    fields: ['ip', 'slot', 'tags'],
  },
  {
    type: 'modbus',
    label: 'Modbus TCP (generic)',
    description: 'Any device speaking Modbus TCP (holding registers / coils).',
    fields: ['ip', 'port', 'unitId', 'tags'],
  },
];
