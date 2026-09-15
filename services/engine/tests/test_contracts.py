import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trace_engine.contracts import (
    ROOT, ContractError, validate_input, validate_result, input_hash,
    timestamps_for_year, hourly_energy_to_half_hourly,
    energy_to_average_power, average_power_to_energy, legacy_azimuth_to_north,
)


def read(name):
    return json.loads((ROOT / 'fixtures' / name).read_text(encoding='utf-8'))


class ContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = {name: read(f'generated/{name}.json') for name in ('factory', 'logistics', 'retail', 'absolute-ac')}

    def test_shared_acceptance_and_rejection_cases(self):
        for case in read('contract-cases.json'):
            with self.subTest(case=case['id']):
                value = copy.deepcopy(self.inputs[case['fixture']])
                for patch in case['patches']:
                    keys = patch['path'][1:].split('/')
                    target = value
                    for key in keys[:-1]:
                        target = target[int(key)] if isinstance(target, list) else target[key]
                    target[int(keys[-1]) if isinstance(target, list) else keys[-1]] = patch['value']
                if case['valid']:
                    self.assertIs(validate_input(value), value)
                else:
                    with self.assertRaises(ContractError):
                        validate_input(value)

    def test_hash_matches_typescript_for_full_inputs(self):
        hashes = read('generated/hashes.json')
        for name, value in self.inputs.items():
            self.assertEqual(input_hash(value), hashes[name])
        for key in self.inputs['factory']['versions']:
            value = copy.deepcopy(self.inputs['factory'])
            value['versions'][key] += '-changed'
            self.assertNotEqual(input_hash(value), hashes['factory'])
        self.assertEqual(input_hash({'😀': 1, '前提': 1e-8, 'zero': -0.0}), input_hash({'zero': 0, '前提': 0.00000001, '😀': 1.0}))

    def test_conversion_conserves_interval_month_year(self):
        hourly = [i % 29 + 0.25 for i in range(8760)]
        energy, times = hourly_energy_to_half_hourly(hourly), timestamps_for_year(2025)
        months, original = [0] * 12, [0] * 12
        for i, v in enumerate(energy):
            self.assertEqual(average_power_to_energy(energy_to_average_power(v)), v)
            month = int(times[i][5:7]) - 1
            months[month] += v
            if i % 2 == 0:
                self.assertEqual(v + energy[i+1], hourly[i//2])
                original[month] += hourly[i//2]
        self.assertEqual(months, original)
        self.assertEqual(sum(energy), sum(hourly))
        self.assertEqual([legacy_azimuth_to_north(v) for v in (-90, 0, 90)], [90, 180, 270])

    def test_result_chronology_recovery(self):
        result = read('generated/result.json')
        validate_result(result)
        result['sustainedRecoveryYear'] = 7
        with self.assertRaises(ContractError):
            validate_result(result)
        result['sustainedRecoveryYear'] = 8
        result['annual'][0]['year'] = 2
        with self.assertRaises(ContractError):
            validate_result(result)

    def test_nonfinite_numbers_rejected(self):
        value = copy.deepcopy(self.inputs['factory'])
        value['site']['latitude']['value'] = float('nan')
        with self.assertRaises(ContractError):
            validate_input(value)

    def test_integer_encoded_as_float_matches_javascript(self):
        value = copy.deepcopy(self.inputs['factory'])
        value['time']['year'] = 2025.0
        validate_input(value)
        self.assertEqual(input_hash(value), read('generated/hashes.json')['factory'])


if __name__ == '__main__':
    unittest.main()
