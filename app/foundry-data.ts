export type AtlasSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
};

export type AtlasPart = {
  id: string;
  name: string;
  system: string;
  description: string;
  sourceId: string;
  color: string;
  sourceUrls: string[];
  confidence: 'high' | 'medium' | 'contextual';
};

export type AtlasHotspot = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type FoundryAtlas = {
  subject: string;
  subtitle: string;
  category: string;
  summary: string;
  accuracyNote: string;
  parts: AtlasPart[];
  sources: AtlasSource[];
  image?: string;
  imageAlt?: string;
  explodedImage?: string;
  explodedImageAlt?: string;
  hotspots?: Record<string, AtlasHotspot | AtlasHotspot[]>;
  mode: 'curated' | 'generated' | 'authoritative-3d';
  generatedAt?: string;
};

const teslaManual = 'https://www.tesla.com/ownersmanual/model3/en_us/';
const teslaService = 'https://service.tesla.com/docs/Model3/ServiceManual/en-us/';
const teslaEmergency = 'https://www.tesla.com/firstresponders';

export const TESLA_DEMO: FoundryAtlas = {
  subject: 'Tesla electric vehicle',
  subtitle: 'Model 3 platform · conceptual systems atlas',
  category: 'Mobility / electric vehicle',
  summary:
    'A research-led overview of the major systems that turn stored electrical energy into a controlled, connected road vehicle. The inventory groups components for learning; exact construction varies by model, year, market, and trim.',
  accuracyNote:
    'Illustrative major-system map, not a teardown, repair guide, or engineering drawing. Always use the exact vehicle manual and qualified service information.',
  mode: 'curated',
  image: '/tesla-assembled-v2.jpg',
  imageAlt: 'Conceptual assembled Tesla Model 3-class electric vehicle in a dark museum studio',
  explodedImage: '/tesla-exploded-v2.jpg',
  explodedImageAlt: 'Conceptual exploded systems illustration of a Tesla Model 3-class electric vehicle',
  hotspots: {
    'body-structure': { x: 45, y: 23, width: 46, height: 30 },
    'battery-pack': { x: 52, y: 78, width: 42, height: 18 },
    'rear-drive': { x: 30, y: 49, width: 17, height: 16 },
    'front-drive': { x: 70, y: 61, width: 22, height: 17 },
    'power-electronics': { x: 15, y: 48, width: 20, height: 18 },
    thermal: { x: 82, y: 48, width: 22, height: 19 },
    suspension: { x: 27, y: 63, width: 24, height: 18 },
    braking: [
      { x: 12, y: 69, width: 12, height: 22 },
      { x: 20, y: 79, width: 14, height: 20 },
      { x: 82, y: 79, width: 14, height: 20 },
      { x: 89, y: 68, width: 12, height: 22 },
    ],
    steering: { x: 46, y: 50, width: 24, height: 17 },
    computers: { x: 59, y: 48, width: 18, height: 15 },
    charging: { x: 12, y: 31, width: 14, height: 16 },
    restraints: { x: 83, y: 27, width: 25, height: 23 },
  },
  sources: [
    { id: 'tesla-owner', title: 'Model 3 Owner\'s Manual', publisher: 'Tesla', url: teslaManual },
    { id: 'tesla-service', title: 'Model 3 Service Manual', publisher: 'Tesla', url: teslaService },
    { id: 'tesla-response', title: 'Emergency Response Guides', publisher: 'Tesla', url: teslaEmergency },
  ],
  parts: [
    {
      id: 'body-structure',
      name: 'Body structure',
      system: 'Structure',
      description: 'The passenger cell, closures, crumple structures, and exterior panels establish the vehicle envelope and manage loads around its occupants.',
      sourceId: 'EV-SYS-01', color: '#d8d0bf', sourceUrls: [teslaService], confidence: 'high',
    },
    {
      id: 'battery-pack',
      name: 'High-voltage battery',
      system: 'Energy',
      description: 'A protected underfloor pack stores electrical energy and supplies high-voltage power to propulsion, charging, and thermal systems.',
      sourceId: 'EV-SYS-02', color: '#d6b56c', sourceUrls: [teslaManual, teslaEmergency], confidence: 'high',
    },
    {
      id: 'rear-drive',
      name: 'Rear drive unit',
      system: 'Propulsion',
      description: 'An integrated electric motor, reduction gear, and differential convert electrical power into torque at the rear wheels.',
      sourceId: 'EV-SYS-03', color: '#ba7a56', sourceUrls: [teslaService], confidence: 'high',
    },
    {
      id: 'front-drive',
      name: 'Front drive unit',
      system: 'Propulsion',
      description: 'On dual-motor variants, a second drive unit powers the front axle and enables electronically coordinated all-wheel drive.',
      sourceId: 'EV-SYS-04', color: '#c98d67', sourceUrls: [teslaManual], confidence: 'contextual',
    },
    {
      id: 'power-electronics',
      name: 'Power electronics',
      system: 'Electrical',
      description: 'Inverters and converters regulate energy flow between the battery, motors, charging inlet, and low-voltage electrical network.',
      sourceId: 'EV-SYS-05', color: '#9e88c7', sourceUrls: [teslaService], confidence: 'high',
    },
    {
      id: 'thermal',
      name: 'Thermal system',
      system: 'Climate',
      description: 'Pumps, valves, heat exchangers, refrigerant hardware, and software keep the cabin, battery, and drive components within useful temperature ranges.',
      sourceId: 'EV-SYS-06', color: '#66a5a0', sourceUrls: [teslaManual, teslaService], confidence: 'high',
    },
    {
      id: 'suspension',
      name: 'Suspension',
      system: 'Chassis',
      description: 'Links, springs, dampers, hubs, and subframes locate the wheels while managing road inputs and body motion.',
      sourceId: 'EV-SYS-07', color: '#8da17b', sourceUrls: [teslaService], confidence: 'high',
    },
    {
      id: 'braking',
      name: 'Braking system',
      system: 'Chassis',
      description: 'Friction brakes work with motor regeneration and electronic control to slow the vehicle and maintain stability.',
      sourceId: 'EV-SYS-08', color: '#bc695f', sourceUrls: [teslaManual, teslaService], confidence: 'high',
    },
    {
      id: 'steering',
      name: 'Steering system',
      system: 'Controls',
      description: 'The steering wheel, column, electric assist, rack, and links translate driver input into front-wheel angle.',
      sourceId: 'EV-SYS-09', color: '#8fa4b4', sourceUrls: [teslaService], confidence: 'high',
    },
    {
      id: 'computers',
      name: 'Vehicle computers',
      system: 'Controls',
      description: 'Distributed controllers process sensing, driver commands, propulsion, safety, cabin, and connectivity functions.',
      sourceId: 'EV-SYS-10', color: '#788faa', sourceUrls: [teslaManual], confidence: 'medium',
    },
    {
      id: 'charging',
      name: 'Charging hardware',
      system: 'Electrical',
      description: 'The charge inlet and onboard conversion hardware connect external power to the high-voltage battery while vehicle controls supervise safe energy transfer.',
      sourceId: 'EV-SYS-11', color: '#b5a369', sourceUrls: [teslaManual, teslaEmergency], confidence: 'high',
    },
    {
      id: 'restraints',
      name: 'Occupant restraints',
      system: 'Safety',
      description: 'Seat belts, airbags, sensors, and control logic form a coordinated restraint system around the protected passenger compartment.',
      sourceId: 'EV-SYS-12', color: '#b27679', sourceUrls: [teslaManual, teslaEmergency], confidence: 'high',
    },
  ],
};
