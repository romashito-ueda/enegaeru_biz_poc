"""Bounded package feasibility checks, not a field-accuracy certification.

Run with Python 3.12 and dependencies from requirements.txt.
Optional: --dependency-dir ../../work/engine-packages (relative to cwd).
No external weather service or customer data is used.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--dependency-dir', type=Path)
args = parser.parse_args()
if args.dependency_dir:
    sys.path.insert(0, str(args.dependency_dir.resolve()))

import numpy as np
import numpy_financial as npf
import PySAM
import PySAM.Battery as Battery
import PySAM.BatteryTools as BatteryTools
import PySAM.Pvwattsv8 as PV
import PySAM.Pvsamv1 as DetailedPV

N, YEARS, DT = 17520, 20, 0.5
dates = [datetime(2025, 1, 1) + timedelta(minutes=15 + i * 30) for i in range(N)]
sun = [max(0, math.sin(math.pi * ((i % 48 + 0.5) / 2 - 6) / 12)) for i in range(N)]
weather = dict(
    lat=35.68, lon=139.76, tz=9, elev=30,
    year=[d.year for d in dates], month=[d.month for d in dates], day=[d.day for d in dates],
    hour=[d.hour for d in dates], minute=[d.minute for d in dates],
    dn=[800*s for s in sun], df=[100*s for s in sun], tdry=[25]*N, wspd=[1]*N,
)

def pv_case(tilt, azimuth):
    model = PV.default('PVWattsNone')
    model.SolarResource.solar_resource_data = weather
    model.SystemDesign.system_capacity = 300
    model.SystemDesign.dc_ac_ratio = 1.2
    model.SystemDesign.tilt = tilt
    model.SystemDesign.azimuth = azimuth
    started = time.perf_counter()
    model.execute()
    elapsed = time.perf_counter() - started
    # SSC gen is average kW; UI interval kWh must be gen * DT.
    values = np.array(model.Outputs.gen)
    assert len(values) == N and np.isfinite(values).all()
    return values, elapsed

generation, pv_seconds = pv_case(20, 180)
flat_east, _ = pv_case(0, 90)
flat_south, _ = pv_case(0, 180)
east, _ = pv_case(20, 90)
west, _ = pv_case(20, 270)
flat_difference = float(np.max(np.abs(flat_east - flat_south)))
direction_difference = float(np.max(np.abs(east - west)))
assert flat_difference < 1e-7
assert direction_difference > 1

load = np.array([80 if 8 <= (i % 48)/2 < 18 else 30 for i in range(N)])
batt = Battery.default('CustomGenerationBatteryCommercial')
batt.BatterySystem.batt_ac_or_dc = 1
# Use the package sizing helper so related cell/current/thermal inputs agree.
BatteryTools.battery_model_sizing(batt, 100, 200, 500, size_by_ac_not_dc=True)
batt.Lifetime.analysis_period = YEARS
batt.Lifetime.system_use_lifetime_output = 1
batt.Lifetime.inflation_rate = 0
# Deliberately repeat identical AC PV for this battery-only lifetime test.
# This does NOT validate PV degradation or clipping over multiple years.
batt.SystemOutput.gen = list(generation) * YEARS
batt.Load.load = list(load)
batt.Load.load_escalation = [0]
batt.Load.crit_load = [0]*N
batt.Load.grid_outage = [0]*N
batt.Load.run_resiliency_calcs = 0
batt.BatteryDispatch.batt_dispatch_choice = 5  # SelfConsumption, PySAM 8.0.0
batt.BatteryDispatch.batt_dispatch_auto_can_gridcharge = 0
batt.BatteryDispatch.batt_dispatch_auto_btm_can_discharge_to_grid = 0
batt.BatterySystem.batt_replacement_option = 2
batt.BatterySystem.batt_replacement_schedule_percent = [100 if y == 11 else 0 for y in range(YEARS)]
batt.ElectricityRates.ur_dc_enable = 0  # Demand-charge evaluation excluded.

input_hash = hashlib.sha256(json.dumps(batt.export(), sort_keys=True).encode()).hexdigest()
started = time.perf_counter()
batt.execute()
battery_seconds = time.perf_counter() - started
out = batt.Outputs
soc = np.array(out.batt_SOC)
capacity = np.array(out.batt_capacity_percent)
replacements = np.array(out.batt_bank_replacement)
assert len(soc) == N * YEARS
assert np.isfinite(soc).all() and np.isfinite(capacity).all()
assert soc.min() >= batt.BatteryCell.batt_minimum_SOC - 1e-3
assert soc.max() <= batt.BatteryCell.batt_maximum_SOC + 1e-3
load_balance = np.tile(load, YEARS) - np.array(out.system_to_load) - np.array(out.batt_to_load) - np.array(out.grid_to_load)
load_balance_error = float(np.max(np.abs(load_balance)))
assert load_balance_error < 1e-5
assert capacity[N * 10 - 1] < capacity[0]
replacement_years = [i+1 for i, v in enumerate(replacements) if v > 0]
assert replacement_years == [12]
assert capacity[N * 11] > capacity[N * 11 - 1]

# Verify that the detailed integrated PV/battery configuration also accepts
# synthetic subhourly weather. This one-year run does NOT replace lifetime QA.
detailed = DetailedPV.default('PVBatteryCommercial')
detailed.SolarResource.solar_resource_data = weather
detailed.Losses.use_snow_weather_file = 0
detailed.Losses.snow_array = [0]*N
detailed.Lifetime.analysis_period = 1
detailed.Lifetime.system_use_lifetime_output = 0
detailed.BatterySystem.en_batt = 0
started = time.perf_counter()
detailed.execute()
detailed_seconds = time.perf_counter() - started
assert len(detailed.Outputs.gen) == N

# An independently solvable annuity checks NPV's t=0 cash-flow convention.
cash = [-100.0] + [30.0]*5
expected_npv = -100 + 30 * (1 - 1.05**-5) / 0.05
actual_npv = float(npf.npv(0.05, cash))
assert abs(actual_npv - expected_npv) < 1e-10

result = {
    'checked_at': '2026-09-08',
    'scope': 'Synthetic package feasibility checks; no demand-charge model, no field validation, no UI integration',
    'python': platform.python_version(),
    'platform': platform.platform(),
    'versions': {name: importlib.metadata.version(name) for name in ['nlr-pysam', 'numpy', 'numpy-financial']},
    'checks': {
        'pv_half_hour_steps': len(generation),
        'pvwatts_single_year_seconds': pv_seconds,
        'horizontal_azimuth_difference_kw': flat_difference,
        'tilted_east_west_max_difference_kw': direction_difference,
        'battery_lifetime_steps': len(soc),
        'battery_20_year_seconds': battery_seconds,
        'battery_load_balance_max_error_kw': load_balance_error,
        'battery_soc_min_percent': float(soc.min()),
        'battery_soc_max_percent': float(soc.max()),
        'battery_year10_end_capacity_percent': float(capacity[N * 10 - 1]),
        'battery_replacement_years': replacement_years,
        'capacity_before_replacement_percent': float(capacity[N * 11 - 1]),
        'capacity_after_replacement_percent': float(capacity[N * 11]),
        'battery_input_sha256': input_hash,
        'pvsamv1_pv_only_half_hour_steps': len(detailed.Outputs.gen),
        'pvsamv1_pv_only_single_year_seconds': detailed_seconds,
        'annuity_npv': actual_npv,
    },
    'not_tested': ['PV lifetime degradation and clipping', 'integrated detailed PV-battery lifetime run',
                   'night charging or peak dispatch', 'Cashloan / Utilityrate5 Japan parameter mapping',
                   'pvlib or REopt execution', 'production latency/concurrency'],
}
path = Path(__file__).with_name('results.json')
path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2, ensure_ascii=False))
