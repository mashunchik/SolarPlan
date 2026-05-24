import type {
  BatteryAdvisory,
  CalculateResponse,
  Solution,
  SolutionId,
  WizardFormData,
} from '../types/calculate.types';

type PVGISMonthlyItem = {
  E_m?: number;
};

type PVGISResponse = {
  outputs?: {
    totals?: {
      fixed?: {
        E_y?: number;
      };
    };
    monthly?: {
      fixed?: PVGISMonthlyItem[];
    };
  };
};

type PVGISGenerationData = {
  yearlyGeneration: number;
  monthlyGeneration: number[];
};

type GeneratedSolutionData = {
  solution: Solution;
  monthlyGeneration: number[];
};

type GeocodingResult = {
  lat?: string;
  lon?: string;
};

type ErrorWithStatus = Error & {
  statusCode?: number;
};

const fallbackSolarProfile = [0.03, 0.05, 0.09, 0.13, 0.16, 0.18, 0.19, 0.17, 0.13, 0.09, 0.05, 0.03];
const heatingConsumptionProfile = [1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1.1, 1.3, 1.4];
const flatConsumptionProfile = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function toNumber(value: string | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function smoothStep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function interpolateSmooth(
  value: number,
  edge0: number,
  edge1: number,
  output0: number,
  output1: number,
) {
  const progress = smoothStep(edge0, edge1, value);
  return output0 + (output1 - output0) * progress;
}

function getSelfUseFactor(ratio: number) {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0.8;

  if (safeRatio <= 0.8) {
    return 0.95;
  }

  if (safeRatio <= 1.2) {
    return interpolateSmooth(safeRatio, 0.8, 1.2, 0.95, 0.9);
  }

  if (safeRatio <= 1.6) {
    return interpolateSmooth(safeRatio, 1.2, 1.6, 0.9, 0.8);
  }

  if (safeRatio <= 2.6) {
    return interpolateSmooth(safeRatio, 1.6, 2.6, 0.8, 0.7);
  }

  return 0.7;
}

function createHttpError(message: string, statusCode: number) {
  const error = new Error(message) as ErrorWithStatus;
  error.statusCode = statusCode;
  return error;
}

function roundToNearestFive(value: number) {
  return Math.round(value / 5) * 5;
}

function formatCurrency(value: number, fractionDigits = 0) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return `${safeValue.toLocaleString('uk-UA', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ?`;
}

function formatPanelPower(valueKw: number) {
  return `${Math.round(valueKw * 1000)} Вт`;
}

function formatBatteryLabel(value: number) {
  return value === 0 ? 'Немає' : `${value} кВт·год`;
}

function getReasonableBatteryCapacity(
  dailyConsumption: number,
  options?: {
    lostEnergy?: number;
    lostEnergyPercent?: number;
  },
) {
  const lostEnergy = options?.lostEnergy ?? 0;
  const lostEnergyPercent = options?.lostEnergyPercent ?? -1;

  if (lostEnergyPercent >= 0) {
    if (lostEnergyPercent < 10) {
      return 0;
    }

    if (lostEnergyPercent < 20) {
      return 5;
    }

    if (lostEnergyPercent <= 35) {
      return lostEnergy < 1200 ? 5 : 10;
    }

    return lostEnergy < 2200 ? 10 : 15;
  }

  if (dailyConsumption <= 6) return 5;
  if (dailyConsumption <= 12) return 10;
  return 15;
}

function selectBatteryCapacity(
  solutionId: SolutionId,
  dailyConsumption: number,
  pvPowerValue: number,
  tariff: number,
  coverageValue: number,
) {
  const reasonableBattery = getReasonableBatteryCapacity(dailyConsumption);

  if (solutionId === 'lowest-cost') {
    if (pvPowerValue < 3.5 || dailyConsumption < 8 || tariff < 5) {
      return 0;
    }

    return Math.min(5, reasonableBattery);
  }

  if (solutionId === 'fastest-payback') {
    if (dailyConsumption < 6 || tariff < 4.5) {
      return 0;
    }

    if (coverageValue < 55 || pvPowerValue < 3.2) {
      return 0;
    }

    if (dailyConsumption <= 12) {
      return Math.min(5, reasonableBattery);
    }

    return Math.min(10, reasonableBattery);
  }

  if (dailyConsumption < 5 || pvPowerValue < 2.5) {
    return 0;
  }

  if (dailyConsumption <= 8) {
    return Math.min(5, reasonableBattery);
  }

  if (dailyConsumption <= 16) {
    return Math.min(10, reasonableBattery);
  }

  return Math.min(15, reasonableBattery);
}

function normalizeMonthlyConsumption(monthlyConsumption?: number[]) {
  if (!Array.isArray(monthlyConsumption) || monthlyConsumption.length !== 12) {
    return null;
  }

  const normalized = monthlyConsumption.map((value) =>
    Number.isFinite(value) && value >= 0 ? value : 0,
  );

  const sum = normalized.reduce((acc, value) => acc + value, 0);

  if (sum <= 0) {
    return null;
  }

  return normalized;
}

function getLegacyMonthlyConsumption(formData: WizardFormData) {
  const normalized = (formData.monthlyData ?? []).map((item) => toNumber(item, 0));

  if (normalized.length !== 12) {
    return null;
  }

  const sum = normalized.reduce((acc, value) => acc + value, 0);

  if (sum <= 0) {
    return null;
  }

  return normalized;
}

export function resolveMonthlyConsumption(formData: WizardFormData): number[] {
  const directMonthlyConsumption = normalizeMonthlyConsumption(formData.monthlyConsumption);

  if (directMonthlyConsumption) {
    console.log('monthlyConsumption mode', 'monthly');
    return directMonthlyConsumption;
  }

  const legacyMonthlyConsumption = getLegacyMonthlyConsumption(formData);

  if (legacyMonthlyConsumption) {
    console.log('monthlyConsumption mode', 'monthly');
    return legacyMonthlyConsumption;
  }

  const annualConsumption = toNumber(formData.annualConsumption, 3600);
  const hasElectricHeating = Boolean(formData.hasElectricHeating ?? formData.electricHeating);
  const profile = hasElectricHeating ? heatingConsumptionProfile : flatConsumptionProfile;
  const sumProfile = profile.reduce((acc, value) => acc + value, 0);
  const generatedMonthlyConsumption = profile.map(
    (value) => (annualConsumption * value) / sumProfile,
  );

  console.log('monthlyConsumption mode', 'generated');

  return generatedMonthlyConsumption;
}

export function resolveAnnualConsumption(formData: WizardFormData) {
  const monthlyConsumption = resolveMonthlyConsumption(formData);
  const monthlySum = monthlyConsumption.reduce((acc, value) => acc + value, 0);

  if (monthlySum > 0) {
    return monthlySum;
  }

  const quickValue = toNumber(formData.annualConsumption, 0);
  if (quickValue > 0) return quickValue;

  return 3600;
}

function calculateEconomicMetrics(
  monthlyGeneration: number[],
  monthlyConsumption: number[],
  pvPowerValue: number,
  batteryCapacity: number,
  tariff: number,
) {
  const batteryEfficiency = 0.9;
  const usableBattery = batteryCapacity * batteryEfficiency;
  const yearlyGeneration = daysInMonth.reduce(
    (sum, _days, index) => sum + Math.max(0, monthlyGeneration[index] ?? 0),
    0,
  );
  const annualConsumption = daysInMonth.reduce(
    (sum, _days, index) => sum + Math.max(0, monthlyConsumption[index] ?? 0),
    0,
  );
  const ratio = annualConsumption > 0 ? yearlyGeneration / annualConsumption : Number.POSITIVE_INFINITY;
  const selfUseFactor = getSelfUseFactor(ratio);

  let totalSelfUsed = daysInMonth.reduce((sum, days, index) => {
    const generation = Math.max(0, monthlyGeneration[index] ?? 0);
    const consumption = Math.max(0, monthlyConsumption[index] ?? 0);
    const directSelfUsed = Math.min(generation, consumption * selfUseFactor);
    const remainingConsumption = Math.max(0, consumption - directSelfUsed);
    const excess = Math.max(0, generation - directSelfUsed);
    const dailyExcess = excess / days;
    const batteryDailyUse = Math.min(
      dailyExcess,
      usableBattery,
      remainingConsumption / days,
    );
    const batteryUsed = batteryDailyUse * days;
    const totalSelfUsedMonth = Math.min(
      consumption,
      directSelfUsed + batteryUsed,
    );

    return sum + totalSelfUsedMonth;
  }, 0);

  totalSelfUsed = Math.min(
    totalSelfUsed,
    annualConsumption,
    yearlyGeneration,
  );

  const lostEnergy = Math.max(0, Math.round(yearlyGeneration - totalSelfUsed));
  const lostEnergyPercent = yearlyGeneration > 0
    ? Number(((lostEnergy / yearlyGeneration) * 100).toFixed(1))
    : 0;
  const yearlySavings = Number((totalSelfUsed * tariff).toFixed(2));
  const panelsCost = pvPowerValue * 35000;
  const inverterCost = pvPowerValue * 8000;
  const installationCost = pvPowerValue * 5000;
  const batteryCost = batteryCapacity * 18000;
  const systemCost = Math.round(panelsCost + inverterCost + installationCost + batteryCost);
  const payback = yearlySavings > 0 ? systemCost / yearlySavings : null;
  const coverageRatio = annualConsumption > 0 ? totalSelfUsed / annualConsumption : 0;
  const selfConsumptionRate = yearlyGeneration > 0 ? totalSelfUsed / yearlyGeneration : 0;

  console.log('totalSelfUsed', totalSelfUsed);
  console.log('yearlySavings', yearlySavings);
  console.log('yearlySavings debug', {
    totalSelfUsed,
    annualConsumption,
    yearlySavings,
  });
  console.log('payback', payback);
  console.log('coverage', coverageRatio * 100);
  console.log('totalSelfUsed vs consumption', totalSelfUsed, annualConsumption);

  return {
    totalSelfUsed,
    yearlyGeneration,
    annualConsumption,
    yearlySavings,
    systemCost,
    paybackYears: payback ?? Number.POSITIVE_INFINITY,
    coverageValue: coverageRatio * 100,
    lostEnergy,
    lostEnergyPercent,
    selfConsumptionRate,
  };
}

function buildBatteryAdvisory(
  monthlyGeneration: number[],
  monthlyConsumption: number[],
  pvPowerValue: number,
  currentBatteryValue: number,
  tariff: number,
  dailyConsumption: number,
  baseMetrics: ReturnType<typeof calculateEconomicMetrics>,
): BatteryAdvisory {
  const recommendedCapacity = Math.max(
    currentBatteryValue,
    getReasonableBatteryCapacity(dailyConsumption, {
      lostEnergy: baseMetrics.lostEnergy,
      lostEnergyPercent: baseMetrics.lostEnergyPercent,
    }),
  );

  const advisoryMetrics = calculateEconomicMetrics(
    monthlyGeneration,
    monthlyConsumption,
    pvPowerValue,
    recommendedCapacity,
    tariff,
  );

  const deltaCoverage = Number((advisoryMetrics.coverageValue - baseMetrics.coverageValue).toFixed(1));
  const deltaSelfUse = Math.round(advisoryMetrics.totalSelfUsed - baseMetrics.totalSelfUsed);
  const deltaLostEnergy = Math.round(baseMetrics.lostEnergy - advisoryMetrics.lostEnergy);

  return {
    recommended:
      recommendedCapacity > currentBatteryValue &&
      recommendedCapacity > 0 &&
      deltaSelfUse > 0 &&
      baseMetrics.lostEnergyPercent >= 10,
    recommendedCapacity,
    estimatedCoverage: Number(advisoryMetrics.coverageValue.toFixed(1)),
    estimatedSelfUse: Math.round(advisoryMetrics.totalSelfUsed),
    estimatedLostEnergy: advisoryMetrics.lostEnergy,
    deltaCoverage,
    deltaSelfUse,
    deltaLostEnergy,
  };
}

export function getGenerationFactor(installationType?: string) {
  switch (installationType) {
    case 'ground':
      return 1150;
    case 'flat_roof':
      return 1100;
    case 'single_slope':
      return 1050;
    case 'double_slope':
      return 1000;
    default:
      return 1050;
  }
}

function getTiltAngle(formData: WizardFormData, latitude?: number) {
  if (formData.installationType === 'flat_roof' || formData.installationType === 'ground') {
    if (typeof latitude === 'number' && Number.isFinite(latitude)) {
      return clamp(roundToNearestFive(latitude), 10, 90);
    }

    return 30;
  }

  const parsedTilt = Number(formData.roofTilt);

  if (Number.isFinite(parsedTilt) && parsedTilt > 0) {
    return parsedTilt;
  }

  return 30;
}

function getAzimuthFromDirection(directionValue?: string) {
  const direction = directionValue?.trim().toLowerCase();

  let azimuth = 0;

  switch (direction) {
    case 'south':
      azimuth = 0;
      break;
    case 'south-east':
    case 'southeast':
      azimuth = -45;
      break;
    case 'east':
      azimuth = -90;
      break;
    case 'north-east':
    case 'northeast':
      azimuth = -135;
      break;
    case 'north':
      azimuth = 180;
      break;
    case 'north-west':
    case 'northwest':
      azimuth = 135;
      break;
    case 'west':
      azimuth = 90;
      break;
    case 'south-west':
    case 'southwest':
      azimuth = 45;
      break;
    default:
      azimuth = 0;
      break;
  }

  console.log('direction', direction);
  console.log('azimuth', azimuth);

  return azimuth;
}

function getAzimuth(formData: WizardFormData) {
  if (formData.installationType === 'flat_roof' || formData.installationType === 'ground') {
    return getAzimuthFromDirection('south');
  }

  return getAzimuthFromDirection(formData.slopeDirection);
}

function getPrimaryPlacementDirection(formData: WizardFormData) {
  if (formData.installationType === 'flat_roof' || formData.installationType === 'ground') {
    return 'south';
  }

  return formData.slopeDirection?.trim().toLowerCase() || 'south';
}

function getRoofSlopesFromRidge(ridgeDirection?: string): [string, string] {
  const normalizedRidgeDirection = ridgeDirection?.trim().toLowerCase();

  switch (normalizedRidgeDirection) {
    case 'east-west':
      return ['south', 'north'];
    case 'north-south':
      return ['east', 'west'];
    case 'north-east-south-west':
    case 'northeast-southwest':
      return ['north-west', 'south-east'];
    case 'north-west-south-east':
    case 'northwest-southeast':
      return ['north-east', 'south-west'];
    default:
      return ['south', 'north'];
  }
}

async function geocodeLocation(location: string): Promise<{ latitude: number; longitude: number } | null> {
  const searchParams = new URLSearchParams({
    q: location,
    format: 'json',
    limit: '1',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams.toString()}`, {
    headers: {
      'User-Agent': 'solar-planner-app',
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed with status ${response.status}`);
  }

  const results = (await response.json()) as GeocodingResult[];
  const firstResult = results[0];

  if (!firstResult?.lat || !firstResult?.lon) {
    return null;
  }

  const latitude = Number(firstResult.lat);
  const longitude = Number(firstResult.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  console.log('geocoding result', location, latitude, longitude);

  return {
    latitude,
    longitude,
  };
}

function getLocationQuery(formData: WizardFormData) {
  return formData.location?.trim() || formData.city?.trim() || formData.coordinates?.trim() || '';
}

export async function getCoordinates(formData: WizardFormData) {
  if (typeof formData.latitude === 'number' && typeof formData.longitude === 'number') {
    return {
      latitude: formData.latitude,
      longitude: formData.longitude,
    };
  }

  const location = getLocationQuery(formData);

  if (location) {
    try {
      const geocodedCoordinates = await geocodeLocation(location);

      if (geocodedCoordinates) {
        return geocodedCoordinates;
      }
    } catch (error: unknown) {
      console.error('geocoding fallback activated', error);
    }
  }

  return {
    latitude: 50,
    longitude: 30,
  };
}

function getFallbackGenerationData(
  installationType: string | undefined,
  pvPowerValue: number,
): PVGISGenerationData {
  const yearlyGeneration = pvPowerValue * getGenerationFactor(installationType);
  const monthlyGeneration = fallbackSolarProfile.map((share) => yearlyGeneration * share);

  return {
    yearlyGeneration,
    monthlyGeneration,
  };
}

async function getPVGISData(
  latitude: number,
  longitude: number,
  pvPower: number,
  tilt: number,
  azimuth: number,
): Promise<PVGISGenerationData> {
  const searchParams = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    peakpower: String(pvPower),
    loss: '14',
    angle: String(tilt),
    aspect: String(azimuth),
    outputformat: 'json',
  });

  // TODO: integrate PVGIS API here
  const response = await fetch(`https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?${searchParams.toString()}`);

  if (!response.ok) {
    throw new Error(`PVGIS request failed with status ${response.status}`);
  }

  const data = (await response.json()) as PVGISResponse;
  const yearlyGeneration = data.outputs?.totals?.fixed?.E_y;
  const monthlyGeneration = data.outputs?.monthly?.fixed?.slice(0, 12).map((item) => item.E_m ?? 0);

  if (
    typeof yearlyGeneration !== 'number' ||
    !Array.isArray(monthlyGeneration) ||
    monthlyGeneration.length !== 12
  ) {
    throw new Error('PVGIS response does not contain expected generation data');
  }

  return {
    yearlyGeneration,
    monthlyGeneration,
  };
}

function getSolutionTitle(id: Solution['id']) {
  if (id === 'lowest-cost') return 'Мінімальна вартість';
  if (id === 'fastest-payback') return 'Найшвидша окупність';
  return 'Максимальна автономність';
}

export function getRecommendedSolutionId(formData: WizardFormData): SolutionId {
  if (
    formData.optimizationGoal === 'lowest-cost' ||
    formData.optimizationGoal === 'fastest-payback' ||
    formData.optimizationGoal === 'max-autonomy'
  ) {
    return formData.optimizationGoal;
  }

  return 'fastest-payback';
}

async function buildSolutionsWithGeneration(formData: WizardFormData): Promise<GeneratedSolutionData[]> {
  const area = toNumber(formData.availableArea, 24);
  const monthlyConsumption = resolveMonthlyConsumption(formData);
  const annualConsumption = monthlyConsumption.reduce((acc, value) => acc + value, 0);
  const dailyConsumption = annualConsumption / 365;
  const tariff = toNumber(formData.electricityTariff, 4.32);
  const { latitude, longitude } = await getCoordinates(formData);
  const tilt = getTiltAngle(formData, latitude);
  const azimuth = getAzimuth(formData);

  console.log('tilt', tilt);
  console.log('azimuth', azimuth);

  const panelPowerKw = 0.4;
  const panelAreaSqM = 2;
  const minPanelsForCandidate = Math.ceil(1.2 / panelPowerKw);
  const batteryOptions = [0, 5, 10, 15] as const;
  const totalMaxPanels = clamp(Math.floor(area / panelAreaSqM), 1, 80);
  const totalMaxPVPower = totalMaxPanels * panelPowerKw;

  const buildCandidate = (
      solutionId: SolutionId,
      placementMode: 'single' | 'slope-a' | 'slope-b' | 'both',
      pvPowerValue: number,
      panels: number,
      occupiedAreaValue: number,
      yearlyGeneration: number,
      monthlyGeneration: number[],
      placementDirections: string[],
      azimuths: number[],
      tiltAngle: number,
      forcedBatteryValue?: number,
    ) => {
    const preliminaryCoveredConsumption = Math.min(yearlyGeneration, annualConsumption);
    const preliminaryCoverageValue = annualConsumption > 0
      ? (preliminaryCoveredConsumption / annualConsumption) * 100
      : 0;
    const batteryValue = typeof forcedBatteryValue === 'number'
      ? forcedBatteryValue
      : solutionId === 'lowest-cost'
        ? 0
        : solutionId === 'max-autonomy'
          ? getReasonableBatteryCapacity(dailyConsumption)
          : selectBatteryCapacity(
              'fastest-payback',
              dailyConsumption,
              pvPowerValue,
              tariff,
              preliminaryCoverageValue,
            );
    const inverterValue = Math.max(3, Math.ceil(pvPowerValue * 1.05));
    const economics = calculateEconomicMetrics(
      monthlyGeneration,
      monthlyConsumption,
      pvPowerValue,
      batteryValue,
      tariff,
    );
    const batteryAdvisory = buildBatteryAdvisory(
      monthlyGeneration,
      monthlyConsumption,
      pvPowerValue,
      batteryValue,
      tariff,
      dailyConsumption,
      economics,
    );

    return {
        placementMode,
        placementDirections,
        azimuths,
        tiltAngle,
        pvPowerValue,
      panels,
      occupiedAreaValue,
      yearlyGeneration: economics.yearlyGeneration,
      monthlyGeneration,
      coverageValue: economics.coverageValue,
      lostEnergy: economics.lostEnergy,
      lostEnergyPercent: economics.lostEnergyPercent,
      batteryValue,
      inverterValue,
      savingsValue: economics.yearlySavings,
      costValue: economics.systemCost,
      paybackYears: economics.paybackYears,
      totalSelfUsed: economics.totalSelfUsed,
      selfConsumptionRate: economics.selfConsumptionRate,
      batteryAdvisory,
    };
  };

  const getPvPowerKey = (candidate: ReturnType<typeof buildCandidate>) =>
    candidate.pvPowerValue.toFixed(1);

  const pickDistinctCandidate = (
    sortedCandidates: Array<ReturnType<typeof buildCandidate>>,
    usedPvPowerKeys: Set<string>,
  ) => {
    if (sortedCandidates.length === 0) {
      throw createHttpError('Не вдалося сформувати рекомендовані сценарії для цієї конфігурації.', 400);
    }

    return sortedCandidates.find((candidate) => !usedPvPowerKeys.has(getPvPowerKey(candidate)))
      ?? sortedCandidates[0];
  };

  const selectGridRecommendations = (
      candidates: Array<ReturnType<typeof buildCandidate>>,
    ) => {
      if (candidates.length === 0) {
        throw createHttpError(
          'Недостатньо доступної площі для формування сценаріїв. Для мінімальної системи потрібно приблизно 6 м².',
          400,
        );
      }

      console.log('candidates count', candidates.length);
      const maxFeasibleCoverage = candidates.reduce(
        (best, candidate) => Math.max(best, candidate.coverageValue / 100),
        0,
      );

      const availableAreaValue = Math.max(area, 1);
      const getRoofUtilization = (candidate: ReturnType<typeof buildCandidate>) =>
        candidate.occupiedAreaValue / availableAreaValue;
      const maxCoverageValue = maxFeasibleCoverage * 100;
      const MAX_BALANCE_PAYBACK_MULTIPLIER = 1.4;
      const MIN_BALANCE_COVERAGE_DELTA = 5;
      const MIN_ADAPTIVE_BALANCE_COVERAGE_DELTA = 1.5;
      const BALANCE_COVERAGE_HEADROOM_REFERENCE = 35;
      const BEST_BALANCE_TARGET_MULTIPLIER = 0.6;
      const BALANCE_COVERAGE_WINDOW = 3;
      const MAX_BALANCE_RATIO = 0.8;
      const BATTERY_FALLBACK_ROOF_UTILIZATION = 0.85;
      const MIN_BALANCE_BATTERY_ROOF_UTILIZATION = 0.35;
      const isFinitePaybackCandidate = (candidate: ReturnType<typeof buildCandidate>) =>
        Number.isFinite(candidate.paybackYears) && candidate.paybackYears > 0;

      const nonBatteryCandidates = candidates.filter((candidate) => candidate.batteryValue === 0);
      const batteryCandidates = candidates.filter((candidate) => candidate.batteryValue > 0);

      let lowestCostPool = nonBatteryCandidates.filter(
        (candidate) => candidate.coverageValue / 100 >= 0.65 && isFinitePaybackCandidate(candidate),
      );

      if (lowestCostPool.length === 0) {
        lowestCostPool = nonBatteryCandidates.filter(
          (candidate) =>
            candidate.coverageValue / 100 >= maxFeasibleCoverage * 0.65 &&
            isFinitePaybackCandidate(candidate),
        );
      }

      if (lowestCostPool.length === 0) {
        lowestCostPool = nonBatteryCandidates.filter(
          (candidate) =>
            candidate.coverageValue / 100 >= maxFeasibleCoverage * 0.5 &&
            isFinitePaybackCandidate(candidate),
        );
      }

      if (lowestCostPool.length === 0) {
        lowestCostPool = nonBatteryCandidates;
      }

      const lowestCostSortedByPower = [...lowestCostPool].sort((a, b) => {
        if (a.pvPowerValue !== b.pvPowerValue) {
          return a.pvPowerValue - b.pvPowerValue;
        }

        return a.costValue - b.costValue;
      });

      let lowestCostCandidate = [...lowestCostPool].sort((a, b) => {
        if (a.costValue !== b.costValue) {
          return a.costValue - b.costValue;
        }

        if (a.paybackYears !== b.paybackYears) {
          return a.paybackYears - b.paybackYears;
        }

        if (a.batteryValue !== b.batteryValue) {
          return a.batteryValue - b.batteryValue;
        }

        return b.coverageValue - a.coverageValue;
      })[0];

      if (lowestCostSortedByPower.length > 1) {
        const MARGINAL_GAIN_RATIO = 0.85;
        const MAX_PAYBACK_STEP_RATIO = 1.18;
        const progressionSteps = lowestCostSortedByPower.slice(1).map((candidate, index) => {
          const previousCandidate = lowestCostSortedByPower[index];

          return {
            coverageGain: candidate.coverageValue - previousCandidate.coverageValue,
            selfUseGain: candidate.totalSelfUsed - previousCandidate.totalSelfUsed,
          };
        });

        const positiveCoverageGains = progressionSteps
          .map((step) => step.coverageGain)
          .filter((value) => value > 0);
        const positiveSelfUseGains = progressionSteps
          .map((step) => step.selfUseGain)
          .filter((value) => value > 0);

        const averageCoverageGain = positiveCoverageGains.length > 0
          ? positiveCoverageGains.reduce((sum, value) => sum + value, 0) / positiveCoverageGains.length
          : 0;
        const averageSelfUseGain = positiveSelfUseGains.length > 0
          ? positiveSelfUseGains.reduce((sum, value) => sum + value, 0) / positiveSelfUseGains.length
          : 0;

        let practicalLowestCostCandidate = lowestCostSortedByPower[0];

        for (let index = 0; index < lowestCostSortedByPower.length - 1; index += 1) {
          const currentCandidate = lowestCostSortedByPower[index];
          const nextCandidate = lowestCostSortedByPower[index + 1];
          const coverageGain = nextCandidate.coverageValue - currentCandidate.coverageValue;
          const selfUseGain = nextCandidate.totalSelfUsed - currentCandidate.totalSelfUsed;
          const paybackStepRatio =
            currentCandidate.paybackYears > 0
              ? nextCandidate.paybackYears / currentCandidate.paybackYears
              : Number.POSITIVE_INFINITY;

          const coverageStillStrong =
            averageCoverageGain > 0
              ? coverageGain >= averageCoverageGain * MARGINAL_GAIN_RATIO
              : coverageGain > 0;
          const selfUseStillStrong =
            averageSelfUseGain > 0
              ? selfUseGain >= averageSelfUseGain * MARGINAL_GAIN_RATIO
              : selfUseGain > 0;
          const economicsStillReasonable = paybackStepRatio <= MAX_PAYBACK_STEP_RATIO;

          if (coverageStillStrong && selfUseStillStrong && economicsStillReasonable) {
            practicalLowestCostCandidate = nextCandidate;
            continue;
          }

          break;
        }

        lowestCostCandidate = practicalLowestCostCandidate;
      }

      const lowestCostBatteryPool =
        getRoofUtilization(lowestCostCandidate) >= BATTERY_FALLBACK_ROOF_UTILIZATION || maxFeasibleCoverage < 0.65
          ? batteryCandidates.filter(
              (candidate) =>
                isFinitePaybackCandidate(candidate) &&
                getRoofUtilization(candidate) >= BATTERY_FALLBACK_ROOF_UTILIZATION &&
                candidate.paybackYears < lowestCostCandidate.paybackYears &&
                candidate.pvPowerValue >= lowestCostCandidate.pvPowerValue,
            )
          : [];

      if (lowestCostBatteryPool.length > 0) {
        const batteryLowestCostCandidate = [...lowestCostBatteryPool].sort((a, b) => {
          if (a.costValue !== b.costValue) {
            return a.costValue - b.costValue;
          }

          if (a.paybackYears !== b.paybackYears) {
            return a.paybackYears - b.paybackYears;
          }

          return b.coverageValue - a.coverageValue;
        })[0];

        if (batteryLowestCostCandidate.paybackYears < lowestCostCandidate.paybackYears) {
          lowestCostCandidate = batteryLowestCostCandidate;
        }
      }

      const baseUsed = lowestCostCandidate.totalSelfUsed;
      const baseCost = lowestCostCandidate.costValue;
      const usedPvPowerKeys = new Set<string>([getPvPowerKey(lowestCostCandidate)]);
      const requiredBalanceCoverageImprovement = clamp(
        MIN_BALANCE_COVERAGE_DELTA *
          ((100 - lowestCostCandidate.coverageValue) / BALANCE_COVERAGE_HEADROOM_REFERENCE),
        MIN_ADAPTIVE_BALANCE_COVERAGE_DELTA,
        MIN_BALANCE_COVERAGE_DELTA,
      );
      const targetBalanceCoverageValue =
        lowestCostCandidate.coverageValue +
        (maxCoverageValue - lowestCostCandidate.coverageValue) * BEST_BALANCE_TARGET_MULTIPLIER;
      const maxAllowedBalanceCoverage =
        lowestCostCandidate.coverageValue +
        (maxCoverageValue - lowestCostCandidate.coverageValue) * MAX_BALANCE_RATIO;
      const balanceBatteryRoofUtilizationThreshold = clamp(
        BATTERY_FALLBACK_ROOF_UTILIZATION * (1 - lowestCostCandidate.coverageValue / 100),
        MIN_BALANCE_BATTERY_ROOF_UTILIZATION,
        BATTERY_FALLBACK_ROOF_UTILIZATION,
      );

      const canUseBatteryForBestBalance = (candidate: ReturnType<typeof buildCandidate>) => {
        if (candidate.batteryValue === 0) {
          return false;
        }

        const roofUtilization = getRoofUtilization(candidate);

        if (roofUtilization < balanceBatteryRoofUtilizationThreshold) {
          return false;
        }

        if (candidate.pvPowerValue < lowestCostCandidate.pvPowerValue) {
          return false;
        }

        return true;
      };

      const buildBestBalancePool = (
        minCoverageRatio: number,
        useBattery: boolean,
      ) => {
        const source = useBattery ? batteryCandidates : nonBatteryCandidates;

        return source.filter(
          (candidate) =>
            isFinitePaybackCandidate(candidate) &&
            candidate.coverageValue / 100 >= minCoverageRatio &&
            candidate.coverageValue >=
              lowestCostCandidate.coverageValue + requiredBalanceCoverageImprovement &&
            (!useBattery || canUseBatteryForBestBalance(candidate)),
        );
      };

      let bestBalancePool = buildBestBalancePool(0.7, false);

      if (bestBalancePool.length === 0) {
        bestBalancePool = buildBestBalancePool(Math.max(0.65, targetBalanceCoverageValue / 100), false);
      }

      if (bestBalancePool.length === 0) {
        bestBalancePool = buildBestBalancePool(Math.max(maxFeasibleCoverage * 0.7, 0.5), false);
      }

      if (bestBalancePool.length === 0) {
        bestBalancePool = buildBestBalancePool(Math.max(0.65, targetBalanceCoverageValue / 100), true);
      }

      if (bestBalancePool.length === 0) {
        bestBalancePool = buildBestBalancePool(Math.max(maxFeasibleCoverage * 0.7, 0.5), true);
      }

      if (bestBalancePool.length === 0) {
        bestBalancePool = candidates.filter(
          (candidate) =>
            isFinitePaybackCandidate(candidate) &&
            candidate.coverageValue >=
              lowestCostCandidate.coverageValue + requiredBalanceCoverageImprovement,
        );
      }

      if (bestBalancePool.length === 0) {
        bestBalancePool = candidates;
      }

      const bestBalanceEconomicsPool = bestBalancePool.filter(
        (candidate) =>
          isFinitePaybackCandidate(candidate) &&
          candidate.paybackYears <= lowestCostCandidate.paybackYears * MAX_BALANCE_PAYBACK_MULTIPLIER,
      );

      const bestBalanceSelectionPool =
        bestBalanceEconomicsPool.length > 0 ? bestBalanceEconomicsPool : bestBalancePool;

      const isInsideBalanceCoverageWindow = (candidate: ReturnType<typeof buildCandidate>) =>
        candidate.coverageValue >= targetBalanceCoverageValue - BALANCE_COVERAGE_WINDOW &&
        candidate.coverageValue <= targetBalanceCoverageValue + BALANCE_COVERAGE_WINDOW;

      const nonBatteryBalanceTargetPool = bestBalanceSelectionPool.filter(
        (candidate) => candidate.batteryValue === 0 && isInsideBalanceCoverageWindow(candidate),
      );
      const batteryBalanceTargetPool = bestBalanceSelectionPool.filter(
        (candidate) => candidate.batteryValue > 0 && isInsideBalanceCoverageWindow(candidate),
      );

      let bestBalanceTargetPool =
        nonBatteryBalanceTargetPool.length > 0
          ? nonBatteryBalanceTargetPool
          : batteryBalanceTargetPool;

      if (bestBalanceTargetPool.length === 0) {
        const nonBatteryClosestDistance = bestBalanceSelectionPool
          .filter((candidate) => candidate.batteryValue === 0)
          .reduce(
            (best, candidate) => Math.min(best, Math.abs(candidate.coverageValue - targetBalanceCoverageValue)),
            Number.POSITIVE_INFINITY,
          );

        if (Number.isFinite(nonBatteryClosestDistance)) {
          bestBalanceTargetPool = bestBalanceSelectionPool.filter(
            (candidate) =>
              candidate.batteryValue === 0 &&
              Math.abs(candidate.coverageValue - targetBalanceCoverageValue) <= nonBatteryClosestDistance + 0.001,
          );
        }
      }

      if (bestBalanceTargetPool.length === 0) {
        const closestDistance = bestBalanceSelectionPool.reduce(
          (best, candidate) => Math.min(best, Math.abs(candidate.coverageValue - targetBalanceCoverageValue)),
          Number.POSITIVE_INFINITY,
        );

        bestBalanceTargetPool = bestBalanceSelectionPool.filter(
          (candidate) => Math.abs(candidate.coverageValue - targetBalanceCoverageValue) <= closestDistance + 0.001,
        );
      }

      const boundedBestBalanceTargetPool = bestBalanceTargetPool.filter(
        (candidate) => candidate.coverageValue <= maxAllowedBalanceCoverage,
      );

      if (boundedBestBalanceTargetPool.length > 0) {
        bestBalanceTargetPool = boundedBestBalanceTargetPool;
      } else {
        const closestBelowUpperBoundPool = bestBalanceSelectionPool.filter(
          (candidate) => candidate.coverageValue <= maxAllowedBalanceCoverage,
        );

        if (closestBelowUpperBoundPool.length > 0) {
          const closestDistanceBelowUpperBound = closestBelowUpperBoundPool.reduce(
            (best, candidate) => Math.min(best, Math.abs(candidate.coverageValue - targetBalanceCoverageValue)),
            Number.POSITIVE_INFINITY,
          );

          bestBalanceTargetPool = closestBelowUpperBoundPool.filter(
            (candidate) =>
              Math.abs(candidate.coverageValue - targetBalanceCoverageValue) <=
              closestDistanceBelowUpperBound + 0.001,
          );
        }
      }

    const bestBalanceSorted = [...bestBalanceTargetPool].sort((a, b) => {
      if (a.lostEnergyPercent !== b.lostEnergyPercent) {
        return a.lostEnergyPercent - b.lostEnergyPercent;
      }

      if (b.totalSelfUsed !== a.totalSelfUsed) {
        return b.totalSelfUsed - a.totalSelfUsed;
      }

      if (a.batteryValue === 0 && b.batteryValue > 0) {
        return -1;
      }

      if (a.batteryValue > 0 && b.batteryValue === 0) {
        return 1;
      }

      if (a.paybackYears !== b.paybackYears) {
        return a.paybackYears - b.paybackYears;
      }

      if (a.costValue !== b.costValue) {
        return a.costValue - b.costValue;
      }

      return b.pvPowerValue - a.pvPowerValue;
    });
    const bestBalanceCandidate = pickDistinctCandidate(bestBalanceSorted, usedPvPowerKeys);
    usedPvPowerKeys.add(getPvPowerKey(bestBalanceCandidate));

      const maxCoverage = maxFeasibleCoverage;
      const COVERAGE_EPSILON = 0.001;
      const maxAutonomyPool = candidates.filter(
        (candidate) => Math.abs((candidate.coverageValue / 100) - maxCoverage) <= COVERAGE_EPSILON,
      );
      const maxAutonomySorted = [...maxAutonomyPool].sort((a, b) => {
      if (b.coverageValue !== a.coverageValue) {
        return b.coverageValue - a.coverageValue;
      }

      if (b.totalSelfUsed !== a.totalSelfUsed) {
        return b.totalSelfUsed - a.totalSelfUsed;
      }

      if (b.savingsValue !== a.savingsValue) {
        return b.savingsValue - a.savingsValue;
      }

      if (a.costValue !== b.costValue) {
        return a.costValue - b.costValue;
      }

      if (a.batteryValue !== b.batteryValue) {
        return a.batteryValue - b.batteryValue;
      }

      return a.paybackYears - b.paybackYears;
    });
    const maxAutonomyCandidate = pickDistinctCandidate(maxAutonomySorted, usedPvPowerKeys);

    return {
      lowestCostCandidate,
      bestBalanceCandidate,
      maxAutonomyCandidate,
    };
  };

  const finalizeSolution = (
    solutionId: SolutionId,
    candidate: ReturnType<typeof buildCandidate>,
  ): GeneratedSolutionData => {
    console.log('chosen scenario', solutionId, candidate.placementMode);

    if (solutionId === 'fastest-payback') {
      console.log('chosen fastest-payback', candidate.paybackYears);
    }

    if (solutionId === 'max-autonomy') {
      console.log('chosen max-autonomy battery', candidate.batteryValue);
    }

    return {
      solution: {
        id: solutionId,
        title: getSolutionTitle(solutionId),
        pvPower: `${candidate.pvPowerValue.toFixed(1)} ???`,
        panels: candidate.panels,
        panelPower: formatPanelPower(panelPowerKw),
        occupiedArea: `${candidate.occupiedAreaValue} ??`,
        inverter: `${candidate.inverterValue} ???`,
        battery: formatBatteryLabel(candidate.batteryValue),
        generation: `${Math.round(candidate.yearlyGeneration).toLocaleString('uk-UA')} ???????/???`,
        coverage: `${Math.round(candidate.coverageValue)}%`,
        payback: `${Number.isFinite(candidate.paybackYears) ? candidate.paybackYears.toFixed(1) : '?'} ?????`,
        cost: formatCurrency(candidate.costValue),
        savings: `${formatCurrency(candidate.savingsValue, 2)}/???`,
        yearlyGenerationValue: candidate.yearlyGeneration,
        coverageValue: candidate.coverageValue,
        totalSelfUsed: Math.round(candidate.totalSelfUsed),
        lostEnergy: candidate.lostEnergy,
        lostEnergyPercent: candidate.lostEnergyPercent,
        batteryAdvisory: candidate.batteryAdvisory,
          placementMode: candidate.placementMode === 'single' ? 'slope-a' : candidate.placementMode,
          placementDirections: candidate.placementDirections,
          azimuths: candidate.azimuths,
          tiltAngle: candidate.tiltAngle,
        },
        monthlyGeneration: candidate.monthlyGeneration,
      };
  };

  if (formData.installationType === 'double_slope') {
    const ridgeDirection = formData.ridgeDirection?.trim().toLowerCase();
    const [slopeDirectionA, slopeDirectionB] = getRoofSlopesFromRidge(formData.ridgeDirection);

    console.log('ridgeDirection', ridgeDirection);
    console.log('slope directions', slopeDirectionA, slopeDirectionB);

    const slopeAreaA = area / 2;
    const slopeAreaB = area / 2;
    const maxPanelsA = clamp(Math.floor(slopeAreaA / panelAreaSqM), 1, 80);
    const maxPanelsB = clamp(Math.floor(slopeAreaB / panelAreaSqM), 1, 80);
    const maxPVPowerA = maxPanelsA * panelPowerKw;
    const maxPVPowerB = maxPanelsB * panelPowerKw;

    const azimuthA = getAzimuthFromDirection(slopeDirectionA);
    const azimuthB = getAzimuthFromDirection(slopeDirectionB);

    let generationPerKWA = getGenerationFactor(formData.installationType);
    let monthlyPerKWA = getFallbackGenerationData(formData.installationType, 1).monthlyGeneration;
    let generationPerKWB = getGenerationFactor(formData.installationType);
    let monthlyPerKWB = getFallbackGenerationData(formData.installationType, 1).monthlyGeneration;

    try {
      const baselineA = await getPVGISData(latitude, longitude, 1, tilt, azimuthA);
      generationPerKWA = baselineA.yearlyGeneration;
      monthlyPerKWA = baselineA.monthlyGeneration;
    } catch (error) {
      console.error('PVGIS slope A fallback activated', error);
    }

    try {
      const baselineB = await getPVGISData(latitude, longitude, 1, tilt, azimuthB);
      generationPerKWB = baselineB.yearlyGeneration;
      monthlyPerKWB = baselineB.monthlyGeneration;
    } catch (error) {
      console.error('PVGIS slope B fallback activated', error);
    }

    const generationPerKWBoth = (generationPerKWA + generationPerKWB) / 2;

    const buildSingleSlopeCandidate = (
      placementMode: 'slope-a' | 'slope-b',
      panels: number,
      generationPerKWForSlope: number,
      monthlyPerKWForSlope: number[],
      directionForSlope: string,
      azimuthForSlope: number,
      forcedBatteryValue: number,
    ) => {
      const pvPowerValue = Number((panels * panelPowerKw).toFixed(1));
      const occupiedAreaValue = panels * panelAreaSqM;
      const yearlyGeneration = generationPerKWForSlope * pvPowerValue;
      const monthlyGeneration = monthlyPerKWForSlope.map((value) => value * pvPowerValue);

      return buildCandidate(
        'fastest-payback',
        placementMode,
        pvPowerValue,
        panels,
        occupiedAreaValue,
        yearlyGeneration,
          monthlyGeneration,
          [directionForSlope],
          [azimuthForSlope],
          tilt,
          forcedBatteryValue,
        );
      };

    const buildBothSlopesCandidate = (totalPanels: number, forcedBatteryValue: number) => {
      let panelsA = Math.min(maxPanelsA, Math.max(1, Math.ceil(totalPanels / 2)));
      let panelsB = Math.min(maxPanelsB, Math.max(1, totalPanels - panelsA));

      let assignedPanels = panelsA + panelsB;
      let remainingPanels = totalPanels - assignedPanels;

      if (remainingPanels > 0) {
        const extraPanelsA = Math.min(maxPanelsA - panelsA, remainingPanels);
        panelsA += extraPanelsA;
        remainingPanels -= extraPanelsA;
      }

      if (remainingPanels > 0) {
        const extraPanelsB = Math.min(maxPanelsB - panelsB, remainingPanels);
        panelsB += extraPanelsB;
      }

      if (panelsA < 1 || panelsB < 1 || panelsA > maxPanelsA || panelsB > maxPanelsB) {
        return null;
      }

      const pvPowerA = panelsA * panelPowerKw;
      const pvPowerB = panelsB * panelPowerKw;
      const pvPowerValue = Number((pvPowerA + pvPowerB).toFixed(1));
      const occupiedAreaValue = (panelsA + panelsB) * panelAreaSqM;
      const yearlyGeneration = generationPerKWA * pvPowerA + generationPerKWB * pvPowerB;
      const monthlyGeneration = monthlyPerKWA.map(
        (value, index) => value * pvPowerA + (monthlyPerKWB[index] ?? 0) * pvPowerB,
      );

      return buildCandidate(
        'fastest-payback',
        'both',
        pvPowerValue,
        panelsA + panelsB,
        occupiedAreaValue,
        yearlyGeneration,
          monthlyGeneration,
          [slopeDirectionA, slopeDirectionB],
          [azimuthA, azimuthB],
          tilt,
          forcedBatteryValue,
        );
      };

    const candidates: Array<ReturnType<typeof buildCandidate>> = [];

    for (let panels = minPanelsForCandidate; panels <= maxPanelsA; panels += 1) {
      for (const batteryOption of batteryOptions) {
        candidates.push(
          buildSingleSlopeCandidate(
            'slope-a',
            panels,
            generationPerKWA,
            monthlyPerKWA,
            slopeDirectionA,
            azimuthA,
            batteryOption,
          ),
        );
      }
    }

    for (let panels = minPanelsForCandidate; panels <= maxPanelsB; panels += 1) {
      for (const batteryOption of batteryOptions) {
        candidates.push(
          buildSingleSlopeCandidate(
            'slope-b',
            panels,
            generationPerKWB,
            monthlyPerKWB,
            slopeDirectionB,
            azimuthB,
            batteryOption,
          ),
        );
      }
    }

    for (let totalPanels = minPanelsForCandidate; totalPanels <= maxPanelsA + maxPanelsB; totalPanels += 1) {
      for (const batteryOption of batteryOptions) {
        const candidate = buildBothSlopesCandidate(totalPanels, batteryOption);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    const {
      lowestCostCandidate,
      bestBalanceCandidate,
      maxAutonomyCandidate,
    } = selectGridRecommendations(candidates);

    return [
      finalizeSolution('lowest-cost', lowestCostCandidate),
      finalizeSolution('fastest-payback', bestBalanceCandidate),
      finalizeSolution('max-autonomy', maxAutonomyCandidate),
    ];
  }

  let generationPerKW = getGenerationFactor(formData.installationType);
  let baselineMonthlyGeneration = getFallbackGenerationData(formData.installationType, 1).monthlyGeneration;

  try {
    const baselineGenerationData = await getPVGISData(latitude, longitude, 1, tilt, azimuth);
    const resolvedGenerationPerKW = baselineGenerationData.yearlyGeneration;

    if (Number.isFinite(resolvedGenerationPerKW) && resolvedGenerationPerKW > 0) {
      generationPerKW = resolvedGenerationPerKW;
    }

    if (baselineGenerationData.monthlyGeneration.length === 12) {
      baselineMonthlyGeneration = baselineGenerationData.monthlyGeneration;
    }
  } catch (error) {
    console.error('PVGIS baseline fallback activated', error);
  }

  console.log('generationPerKW', generationPerKW);

  let requiredPVPower = annualConsumption / generationPerKW;

  if (!Number.isFinite(requiredPVPower) || requiredPVPower <= 0) {
    requiredPVPower = 1;
  }

  if (requiredPVPower > totalMaxPVPower) {
    requiredPVPower = totalMaxPVPower;
  }

  requiredPVPower = Math.max(1, requiredPVPower);

  console.log('requiredPVPower', requiredPVPower);

  const primaryPlacementDirection = getPrimaryPlacementDirection(formData);

  const buildSingleSurfaceCandidate = (panels: number, forcedBatteryValue: number) => {
    const pvPowerValue = Number((panels * panelPowerKw).toFixed(1));
    const occupiedAreaValue = panels * panelAreaSqM;
    const yearlyGeneration = generationPerKW * pvPowerValue;
    const monthlyGeneration = baselineMonthlyGeneration.map((value) => value * pvPowerValue);

    return buildCandidate(
      'fastest-payback',
      'single',
      pvPowerValue,
      panels,
      occupiedAreaValue,
      yearlyGeneration,
        monthlyGeneration,
        [primaryPlacementDirection],
        [azimuth],
        tilt,
        forcedBatteryValue,
      );
    };

  const candidates: Array<ReturnType<typeof buildCandidate>> = [];

  for (let panels = minPanelsForCandidate; panels <= totalMaxPanels; panels += 1) {
    for (const batteryOption of batteryOptions) {
      candidates.push(buildSingleSurfaceCandidate(panels, batteryOption));
    }
  }

  const {
    lowestCostCandidate,
    bestBalanceCandidate,
    maxAutonomyCandidate,
  } = selectGridRecommendations(candidates);

  return [
    finalizeSolution('lowest-cost', lowestCostCandidate),
    finalizeSolution('fastest-payback', bestBalanceCandidate),
    finalizeSolution('max-autonomy', maxAutonomyCandidate),
  ];
}

export async function generateSolutions(formData: WizardFormData): Promise<Solution[]> {
  const solutionData = await buildSolutionsWithGeneration(formData);
  return solutionData.map((item) => item.solution);
}

export async function calculateProject(formData: WizardFormData): Promise<CalculateResponse> {
  const solutionData = await buildSolutionsWithGeneration(formData);
  const recommendedSolutionId = getRecommendedSolutionId(formData);
  const recommendedSolutionData =
    solutionData.find((item) => item.solution.id === recommendedSolutionId) ?? solutionData[0];

  return {
    solutions: solutionData.map((item) => item.solution),
    recommendedSolutionId,
    annualConsumption: resolveAnnualConsumption(formData),
    monthlyConsumption: resolveMonthlyConsumption(formData),
    monthlyGeneration: recommendedSolutionData?.monthlyGeneration,
  };
}
