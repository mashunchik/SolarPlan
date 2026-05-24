export type InstallationType =
  | 'ground'
  | 'flat_roof'
  | 'single_slope'
  | 'double_slope';

export type ConsumptionType = 'quick' | 'detailed';

export type OptimizationGoal =
  | 'lowest-cost'
  | 'fastest-payback'
  | 'max-autonomy';

export type RoofTiltPreset = 'low' | 'medium' | 'standard' | 'steep' | '';

export type WizardFormData = {
  city: string;
  coordinates: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  installationType: InstallationType | string;
  slopeDirection: string;
  ridgeDirection: string;
  roofTilt: string;
  roofTiltUnknown: boolean;
  roofTiltPreset: RoofTiltPreset;
  availableArea: string;
  consumptionType: ConsumptionType | string;
  annualConsumption: string;
  monthlyData: string[];
  monthlyConsumption?: number[];
  electricHeating: boolean;
  hasElectricHeating?: boolean;
  electricityTariff: string;
  optimizationGoal: OptimizationGoal | string;
};

export type SolutionId = 'lowest-cost' | 'fastest-payback' | 'max-autonomy';

export type BatteryAdvisory = {
  recommended: boolean;
  recommendedCapacity: number;
  estimatedCoverage: number;
  estimatedSelfUse: number;
  estimatedLostEnergy: number;
  deltaCoverage: number;
  deltaSelfUse: number;
  deltaLostEnergy: number;
};

export type Solution = {
  id: SolutionId;
  title: string;
  pvPower: string;
  panels: number;
  panelPower: string;
  occupiedArea: string;
  inverter: string;
  battery: string;
  generation: string;
  coverage: string;
  payback: string;
  cost: string;
  savings: string;
  yearlyGenerationValue: number;
  coverageValue: number;
  totalSelfUsed?: number;
  lostEnergy: number;
  lostEnergyPercent: number;
  batteryAdvisory?: BatteryAdvisory;
  placementMode?: 'slope-a' | 'slope-b' | 'both';
  placementDirections?: string[];
  azimuths?: number[];
  tiltAngle?: number;
};

export type CalculateRequestBody = {
  formData?: WizardFormData;
};

export type CalculateResponse = {
  solutions: Solution[];
  recommendedSolutionId: SolutionId;
  annualConsumption: number;
  monthlyConsumption?: number[];
  monthlyGeneration?: number[];
};
