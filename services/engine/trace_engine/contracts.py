"""Shared JSON Schema plus cross-field invariants. No simulation equations here."""
from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import json
import math
from pathlib import Path
import struct

from jsonschema import Draft7Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[3]
VALIDATORS = {
    name: Draft7Validator(json.loads((ROOT / 'contracts' / 'generated' / f'{name}.schema.json').read_text(encoding='utf-8')), format_checker=FormatChecker())
    for name in ('input', 'result')
}


class ContractError(ValueError):
    pass


def timestamps_for_year(year: int) -> list[str]:
    if isinstance(year, bool) or year != int(year) or not 2001 <= year <= 2099 or year % 4 == 0:
        raise ContractError('time: leap/unsupported year')
    start = datetime(int(year), 1, 1)
    return [(start + timedelta(minutes=i * 30)).isoformat() + '+09:00' for i in range(17520)]


def energy_to_average_power(kwh: float) -> float:
    return kwh / 0.5


def average_power_to_energy(kw: float) -> float:
    return kw * 0.5


def legacy_azimuth_to_north(degrees: float) -> float:
    if not math.isfinite(degrees) or not -90 <= degrees <= 90:
        raise ContractError('Invalid legacy azimuth')
    return (180 + degrees) % 360


def hourly_energy_to_half_hourly(hourly: list[float]) -> list[float]:
    if len(hourly) != 8760 or any(not math.isfinite(v) or v < 0 for v in hourly):
        raise ContractError('Expected 8760 nonnegative hourly kWh values')
    return [v / 2 for v in hourly for _ in range(2)]


def canonical_input(value) -> str:
    if value is None:
        return 'n'
    if isinstance(value, bool):
        return 't' if value else 'f'
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ContractError('Non-finite input')
        return 'd' + struct.pack('>d', 0.0 if value == 0 else float(value)).hex()
    if isinstance(value, str):
        return 's' + json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if isinstance(value, list):
        return '[' + ','.join(canonical_input(v) for v in value) + ']'
    if isinstance(value, dict):
        return '{' + ','.join(canonical_input(k) + ':' + canonical_input(value[k]) for k in sorted(value, key=lambda k: k.encode('utf-8'))) + '}'
    raise ContractError('Expected JSON data')


def input_hash(value) -> str:
    return hashlib.sha256(canonical_input(value).encode('utf-8')).hexdigest()


def _facts(value, path: str, errors: list[str]):
    if isinstance(value, float) and not math.isfinite(value):
        errors.append(f'{path}: non-finite number')
    if isinstance(value, list):
        for i, child in enumerate(value):
            _facts(child, f'{path}/{i}', errors)
    if not isinstance(value, dict):
        return
    if 'provenance' in value:
        p = value['provenance']
        if datetime.fromisoformat(p['period']['start']) >= datetime.fromisoformat(p['period']['endExclusive']):
            errors.append(f'{path}: invalid provenance period')
        if p['confirmation'] == 'site_verified' and p['kind'] != 'observed':
            errors.append(f'{path}: only observed values can be site_verified')
        if p.get('originalResolutionMinutes') == 60 and not p.get('transformation'):
            errors.append(f'{path}: missing resolution transformation')
        if 'uncertainty' in value:
            u, v = value['uncertainty'], value['value']
            if not isinstance(v, (int, float)) or isinstance(v, bool) or u['min'] > u['max'] or not u['min'] <= v <= u['max']:
                errors.append(f'{path}: invalid uncertainty range')
    for key, child in value.items():
        _facts(child, f'{path}/{key}', errors)


def _schema(name: str, value):
    error = next(VALIDATORS[name].iter_errors(value), None)
    if error:
        # Do not log full arrays / customer data inside library error messages.
        raise ContractError(f'{"/".join(str(p) for p in error.absolute_path)}: schema {error.validator}')


def validate_input(value: dict) -> dict:
    _schema('input', value)
    errors = []
    try:
        if value['time']['timestamps'] != timestamps_for_year(value['time']['year']):
            errors.append('time: expected contiguous JST interval-start timestamps')
    except ContractError as e:
        errors.append(str(e))
    roofs = {r['id'] for r in value['roofs']}
    allowed = set(value['constraints']['allowedRoofIds'])
    if len(roofs) != len(value['roofs']):
        errors.append('roofs: duplicate id')
    if not allowed <= roofs:
        errors.append('constraints: unknown roof')
    pv, battery = value['equipment']['pv'], value['equipment']['battery']
    allocations = pv['roofAllocations']
    if len({a['roofId'] for a in allocations}) != len(allocations):
        errors.append('equipment: duplicate roof allocation')
    if any(a['roofId'] not in allowed for a in allocations):
        errors.append('equipment: roof not allowed')
    if abs(sum(a['dcCapacity']['value'] for a in allocations) - pv['dcCapacity']['value']) > 1e-6:
        errors.append('equipment: PV allocation does not sum to DC capacity')
    if (pv['dcCapacity']['value'] == 0) != (pv['acCapacity']['value'] == 0):
        errors.append('equipment: PV DC/AC must both be zero or positive')
    if (battery['capacity']['value'] == 0) != (battery['power']['value'] == 0):
        errors.append('equipment: battery capacity/power must both be zero or positive')
    if battery['initialSoc']['value'] < battery['minimumSoc']['value']:
        errors.append('equipment: initial SOC below minimum')
    generation = value['generation']
    if generation['kind'] == 'absolute_ac':
        binding = generation['binding']
        if binding['pvDcKw'] != pv['dcCapacity']['value'] or binding['pvAcKw'] != pv['acCapacity']['value'] or binding['roofsVersion'] != value['versions']['roofs']:
            errors.append('generation: absolute AC equipment mismatch')
        geometry = [{'roofId': a['roofId'], 'tilt': r['tilt']['value'], 'azimuth': r['azimuth']['value'], 'shadingLoss': r['shadingLoss']['value'], 'dcKw': a['dcCapacity']['value']}
                    for a in allocations for r in value['roofs'] if r['id'] == a['roofId']]
        if sorted(binding['roofGeometry'], key=lambda r: r['roofId']) != sorted(geometry, key=lambda r: r['roofId']):
            errors.append('generation: absolute AC roof geometry mismatch')
        if any(v > binding['pvAcKw'] * 0.5 + 1e-6 for v in generation['energy']['value']):
            errors.append('generation: AC energy exceeds bound PCS')
        if any(s['solarScale']['value'] != 1 for s in value['scenarios']):
            errors.append('generation: cannot rescale absolute AC')
    series_facts = [value['load']['energy'], value['tariff']['purchase'], value['tariff']['export']]
    series_facts += [generation[k] for k in ('dni', 'dhi', 'temperature', 'windSpeed')] if generation['kind'] == 'weather' else [generation['energy']]
    year = int(value['time']['year'])
    start, end = f'{year}-01-01T00:00:00+09:00', f'{year + 1}-01-01T00:00:00+09:00'
    if any(s['provenance']['period']['start'] != start or s['provenance']['period']['endExclusive'] != end for s in series_facts):
        errors.append('series: provenance period must match time axis')
    if len({s['id'] for s in value['scenarios']}) != len(value['scenarios']):
        errors.append('scenarios: duplicate id')
    if len({e['id'] for e in value['costs']['events']}) != len(value['costs']['events']):
        errors.append('costs: duplicate event id')
    for event in value['costs']['events']:
        if event['kind'] == 'replacement' and (event['year'] == 0 or event['target'] == 'project'):
            errors.append('costs: invalid replacement target/year')
        if event['kind'] == 'replacement' and event['target'] == 'battery' and 'replacedCapacityFraction' not in event:
            errors.append('costs: battery replacement needs a capacity fraction')
        if (event['kind'] != 'replacement' or event['target'] != 'battery') and 'replacedCapacityFraction' in event:
            errors.append('costs: unexpected replacement capacity')
    _facts(value, '', errors)
    if errors:
        raise ContractError('; '.join(errors))
    return value


def validate_result(value: dict) -> dict:
    _schema('result', value)
    errors = []
    if [v['year'] for v in value['annual']] != list(range(1, 21)):
        errors.append('result: annual years must be 1 through 20')
    if value['sustainedRecoveryYear'] is not None and (value['firstBreakEvenYear'] is None or value['sustainedRecoveryYear'] < value['firstBreakEvenYear']):
        errors.append('result: inconsistent recovery years')
    _facts(value, '', errors)
    if errors:
        raise ContractError('; '.join(errors))
    return value
