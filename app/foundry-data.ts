export type AtlasSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
};

export type SupplierStatus = 'confirmed' | 'reported' | 'rumored';
export type SupplierRole = 'manufacturer' | 'assembler' | 'designer' | 'ip-licensor' | 'software-provider' | 'material-supplier' | 'integrator' | 'other';

export type AtlasSupplier = {
  company: string;
  role?: SupplierRole;
  isPublicCompany: boolean;
  ticker: string | null;
  exchange: string | null;
  yahooSymbol: string | null;
  evidenceUrl: string;
  financeUrl: string | null;
  relationshipStatus: SupplierStatus;
  note: string;
};

export type AtlasConnection = {
  toPartId: string;
  relationship: 'power' | 'data' | 'thermal' | 'fluid' | 'mechanical' | 'structural' | 'control' | 'other';
  description: string;
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
  suppliers?: AtlasSupplier[];
  connections?: AtlasConnection[];
};

export type AtlasHotspot = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type FoundryAtlas = {
  cacheKey?: string;
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
  imageOrientation: 'landscape' | 'portrait';
  hotspots?: Record<string, AtlasHotspot | AtlasHotspot[]>;
  mode: 'curated' | 'generated' | 'authoritative-3d';
  generatedAt?: string;
};

export type AtlasGalleryItem = {
  cacheKey: string;
  subject: string;
  subtitle: string;
  category: string;
  image?: string;
  explodedImage?: string;
  imageOrientation: 'landscape' | 'portrait';
  partCount: number;
  supplierCount: number;
  generatedAt?: string;
};

const teslaManual = 'https://www.tesla.com/ownersmanual/model3/en_us/';
const teslaService = 'https://service.tesla.com/docs/Model3/ServiceManual/en-us/';
const teslaEmergency = 'https://www.tesla.com/firstresponders';
const teslaSupplierCutaway = 'https://s3-prod.autonews.com/s3fs-public/CA843311210.PDF';
const teslaPanasonicAgreement = 'https://ir.tesla.com/_flysystem/s3/sec/000156459020029536/tsla-8k_20200610-gen_0.pdf';
const teslaAutonomyReport = 'https://www.govinfo.gov/content/pkg/GOVPUB-ITC1-PURL-gpo190579/pdf/GOVPUB-ITC1-PURL-gpo190579.pdf';
const teslaSemiconductorStudy = 'https://grips.repo.nii.ac.jp/record/2000182/files/24-15%28rev%29.pdf';

export const TESLA_DEMO: FoundryAtlas = {
  subject: 'Tesla electric vehicle',
  subtitle: 'Cross-generation platform · conceptual systems and supplier atlas',
  category: 'Mobility / electric vehicle',
  summary:
    'A research-led overview of the major systems that turn stored electrical energy into a controlled, connected road vehicle. Supplier records span documented Tesla generations and say which model or period the evidence covers; they must not be assumed to apply to every vehicle.',
  accuracyNote:
    'Illustrative cross-generation map, not a teardown, repair guide, or engineering drawing. Supplier relationships vary by model, generation, plant, market, and trim; read each evidence label and scope note.',
  mode: 'curated',
  imageOrientation: 'landscape',
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
    { id: 'tesla-supplier-cutaway', title: 'Suppliers to the 2013 Tesla Model S', publisher: 'SupplierBusiness / Automotive News', url: teslaSupplierCutaway },
    { id: 'tesla-panasonic', title: 'Tesla–Panasonic Gigafactory 2170 cell agreement', publisher: 'Tesla investor relations / SEC filing', url: teslaPanasonicAgreement },
    { id: 'tesla-autonomy', title: 'Building Vehicle Autonomy: Sensors, Semiconductors, Software and U.S. Competitiveness', publisher: 'U.S. International Trade Commission', url: teslaAutonomyReport },
    { id: 'tesla-semiconductors', title: 'Tesla Model 3 semiconductor supply-chain study', publisher: 'GRIPS', url: teslaSemiconductorStudy },
  ],
  parts: [
    {
      id: 'body-structure',
      name: 'Body structure',
      system: 'Structure',
      description: 'The passenger cell, closures, crumple structures, and exterior panels establish the vehicle envelope and manage loads around its occupants.',
      sourceId: 'EV-SYS-01', color: '#d8d0bf', sourceUrls: [teslaService, teslaSupplierCutaway], confidence: 'high',
      suppliers: [{
        company: 'Tesla, Inc.', isPublicCompany: true, ticker: 'TSLA', exchange: 'NASDAQ', yahooSymbol: 'TSLA', financeUrl: 'https://finance.yahoo.com/quote/TSLA/',
        evidenceUrl: teslaSupplierCutaway, relationshipStatus: 'reported', note: 'SupplierBusiness attributes Class A stampings and plastics to Tesla for the 2013 Model S; later generations and other models may use different sourcing.',
      }],
    },
    {
      id: 'battery-pack',
      name: 'High-voltage battery',
      system: 'Energy',
      description: 'A protected underfloor pack stores electrical energy and supplies high-voltage power to propulsion, charging, and thermal systems.',
      sourceId: 'EV-SYS-02', color: '#d6b56c', sourceUrls: [teslaManual, teslaEmergency, teslaPanasonicAgreement], confidence: 'high',
      suppliers: [{
        company: 'Panasonic Holdings', isPublicCompany: true, ticker: '6752', exchange: 'Tokyo', yahooSymbol: '6752.T', financeUrl: 'https://finance.yahoo.com/quote/6752.T/',
        evidenceUrl: teslaPanasonicAgreement, relationshipStatus: 'confirmed', note: 'Tesla’s 2020 filing confirms Panasonic manufacture and supply of Gigafactory Nevada 2170 cells; this does not cover every battery chemistry, plant, or vehicle generation.',
      }],
    },
    {
      id: 'rear-drive',
      name: 'Rear drive unit',
      system: 'Propulsion',
      description: 'An integrated electric motor, reduction gear, and differential convert electrical power into torque at the rear wheels.',
      sourceId: 'EV-SYS-03', color: '#ba7a56', sourceUrls: [teslaService, teslaSupplierCutaway], confidence: 'high',
      suppliers: [{
        company: 'Tesla, Inc.', isPublicCompany: true, ticker: 'TSLA', exchange: 'NASDAQ', yahooSymbol: 'TSLA', financeUrl: 'https://finance.yahoo.com/quote/TSLA/',
        evidenceUrl: teslaSupplierCutaway, relationshipStatus: 'reported', note: 'SupplierBusiness attributes motor manufacture to Tesla for the 2013 Model S; drive-unit sourcing and content differ across models and generations.',
      }],
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
      sourceId: 'EV-SYS-05', color: '#9e88c7', sourceUrls: [teslaService, teslaSemiconductorStudy], confidence: 'high',
      suppliers: [
        {
          company: 'Infineon Technologies', isPublicCompany: true, ticker: 'IFX', exchange: 'Xetra', yahooSymbol: 'IFX.DE', financeUrl: 'https://finance.yahoo.com/quote/IFX.DE/',
          evidenceUrl: teslaSemiconductorStudy, relationshipStatus: 'reported', note: 'A 2024 academic supply-chain study identifies Infineon among Model 3 semiconductor suppliers; the finding is component-class evidence, not a guarantee for every power-electronics board or generation.',
        },
        {
          company: 'STMicroelectronics', isPublicCompany: true, ticker: 'STM', exchange: 'NYSE', yahooSymbol: 'STM', financeUrl: 'https://finance.yahoo.com/quote/STM/',
          evidenceUrl: teslaSemiconductorStudy, relationshipStatus: 'reported', note: 'The same Model 3 study identifies STMicroelectronics among semiconductor suppliers; exact device fitment varies by controller revision and production period.',
        },
      ],
    },
    {
      id: 'thermal',
      name: 'Thermal system',
      system: 'Climate',
      description: 'Pumps, valves, heat exchangers, refrigerant hardware, and software keep the cabin, battery, and drive components within useful temperature ranges.',
      sourceId: 'EV-SYS-06', color: '#66a5a0', sourceUrls: [teslaManual, teslaService, teslaSupplierCutaway], confidence: 'high',
      suppliers: [{
        company: 'Modine Manufacturing', isPublicCompany: true, ticker: 'MOD', exchange: 'NYSE', yahooSymbol: 'MOD', financeUrl: 'https://finance.yahoo.com/quote/MOD/',
        evidenceUrl: teslaSupplierCutaway, relationshipStatus: 'reported', note: 'SupplierBusiness identifies Modine as battery-chiller supplier for the 2013 Model S; this is not evidence for later heat-pump systems or every Tesla model.',
      }],
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
      sourceId: 'EV-SYS-08', color: '#bc695f', sourceUrls: [teslaManual, teslaService, teslaSupplierCutaway], confidence: 'high',
      suppliers: [{
        company: 'Brembo', isPublicCompany: true, ticker: 'BRE', exchange: 'Milan', yahooSymbol: 'BRE.MI', financeUrl: 'https://finance.yahoo.com/quote/BRE.MI/',
        evidenceUrl: teslaSupplierCutaway, relationshipStatus: 'reported', note: 'SupplierBusiness identifies Brembo calipers and discs on the 2013 Model S; brake suppliers and hardware vary by model, axle, trim, and generation.',
      }],
    },
    {
      id: 'steering',
      name: 'Steering system',
      system: 'Controls',
      description: 'The steering wheel, column, electric assist, rack, and links translate driver input into front-wheel angle.',
      sourceId: 'EV-SYS-09', color: '#8fa4b4', sourceUrls: [teslaService, teslaSupplierCutaway], confidence: 'high',
      suppliers: [{
        company: 'ZF Lenksysteme', isPublicCompany: false, ticker: null, exchange: null, yahooSymbol: null, financeUrl: null,
        evidenceUrl: teslaSupplierCutaway, relationshipStatus: 'reported', note: 'SupplierBusiness identifies ZF Lenksysteme as the electronic-power-steering supplier for the 2013 Model S. This does not establish ZF fitment on the Model 3 or every later Tesla generation.',
      }],
    },
    {
      id: 'computers',
      name: 'Vehicle computers',
      system: 'Controls',
      description: 'Distributed controllers process sensing, driver commands, propulsion, safety, cabin, and connectivity functions.',
      sourceId: 'EV-SYS-10', color: '#788faa', sourceUrls: [teslaManual, teslaAutonomyReport], confidence: 'medium',
      suppliers: [{
        company: 'Samsung Electronics', isPublicCompany: true, ticker: '005930', exchange: 'Korea', yahooSymbol: '005930.KS', financeUrl: 'https://finance.yahoo.com/quote/005930.KS/',
        evidenceUrl: teslaAutonomyReport, relationshipStatus: 'confirmed', note: 'A U.S. International Trade Commission report states that Samsung manufactured Tesla’s FSD system-on-chip in Austin; this applies to that computer generation, not every vehicle controller.',
      }],
    },
    {
      id: 'charging',
      name: 'Charging hardware',
      system: 'Electrical',
      description: 'The charge inlet and onboard conversion hardware connect external power to the high-voltage battery while vehicle controls supervise safe energy transfer.',
      sourceId: 'EV-SYS-11', color: '#b5a369', sourceUrls: [teslaManual, teslaEmergency, teslaSupplierCutaway], confidence: 'high',
      suppliers: [{
        company: 'Tesla, Inc.', isPublicCompany: true, ticker: 'TSLA', exchange: 'NASDAQ', yahooSymbol: 'TSLA', financeUrl: 'https://finance.yahoo.com/quote/TSLA/',
        evidenceUrl: teslaSupplierCutaway, relationshipStatus: 'reported', note: 'SupplierBusiness attributes the onboard charger and universal connector to Tesla for the 2013 Model S; charging hardware changes across platforms and generations.',
      }],
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
