import { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';

// ─── Data singleton ───────────────────────────────────────────────────────────

let _names: string[] | null = null;
function getNames(): string[] {
  if (!_names) _names = require('../data/rxnorm-names.json') as string[];
  return _names;
}

// ─── Binary search ────────────────────────────────────────────────────────────

function lowerBound(names: string[], prefix: string): number {
  let lo = 0, hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (names[mid].toLowerCase() < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

function prefixSearch(input: string, limit = 8): string[] {
  if (!input) return [];
  const names = getNames();
  const lower = input.toLowerCase();
  const start = lowerBound(names, lower);
  const results: string[] = [];
  for (let i = start; i < names.length && results.length < limit; i++) {
    if (names[i].toLowerCase().startsWith(lower)) results.push(names[i]);
    else break;
  }
  return results;
}

function isExactMatch(input: string): boolean {
  if (!input) return false;
  const names = getNames();
  const lower = input.toLowerCase();
  const idx = lowerBound(names, lower);
  return idx < names.length && names[idx].toLowerCase() === lower;
}

// ─── Spellcheck ───────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function spellCheck(input: string, limit = 3): string[] {
  if (input.length < 3) return [];
  const names = getNames();
  const lower = input.toLowerCase();
  const prefix2 = lower.slice(0, 2);
  const start = lowerBound(names, prefix2);
  const candidates: { name: string; dist: number }[] = [];
  for (let i = start; i < names.length; i++) {
    const nl = names[i].toLowerCase();
    if (!nl.startsWith(prefix2)) break;
    const dist = levenshtein(lower, nl);
    if (dist > 0 && dist <= 3) candidates.push({ name: names[i], dist });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, limit).map((c) => c.name);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value: string;
  onChangeText: (text: string) => void;
  inputStyle?: TextStyle | TextStyle[];
  containerStyle?: ViewStyle;
}

export function MedicationNameInput({
  value,
  onChangeText,
  inputStyle,
  containerStyle,
  ...rest
}: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [spellSuggestions, setSpellSuggestions] = useState<string[]>([]);
  const [recognized, setRecognized] = useState(() => isExactMatch(value));
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  function handleChangeText(text: string) {
    valueRef.current = text;
    onChangeText(text);
    setSpellSuggestions([]);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const results = prefixSearch(valueRef.current);
      setSuggestions(results);
      setRecognized(isExactMatch(valueRef.current));
    }, 250);
  }

  function handleFocus() {
    setFocused(true);
    if (valueRef.current) {
      setSuggestions(prefixSearch(valueRef.current));
    }
  }

  function handleBlur() {
    setFocused(false);
    setSuggestions([]);
    const current = valueRef.current;
    if (current && !isExactMatch(current)) {
      setSpellSuggestions(spellCheck(current));
    }
  }

  function select(name: string) {
    valueRef.current = name;
    onChangeText(name);
    setSuggestions([]);
    setSpellSuggestions([]);
    setRecognized(true);
  }

  const showDropdown = focused && suggestions.length > 0;

  return (
    <View style={[c.container, containerStyle]}>
      <View style={c.inputRow}>
        <TextInput
          {...rest}
          value={value}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[c.inputBase, inputStyle]}
          autoCorrect={false}
          autoCapitalize="words"
        />
        {recognized && (
          <View style={c.badge}>
            <Text style={c.badgeText}>✓</Text>
          </View>
        )}
      </View>

      {showDropdown && (
        <View style={c.dropdown}>
          {suggestions.map((name) => (
            <TouchableOpacity
              key={name}
              style={c.suggestion}
              onPressIn={() => select(name)}
            >
              <Text style={c.suggestionText}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!focused && spellSuggestions.length > 0 && (
        <View style={c.spellRow}>
          <Text style={c.spellLabel}>Did you mean?</Text>
          {spellSuggestions.map((name) => (
            <TouchableOpacity key={name} style={c.spellChip} onPress={() => select(name)}>
              <Text style={c.spellChipText}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const c = StyleSheet.create({
  container: {},
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  inputBase: { flex: 1 },
  badge: {
    position: 'absolute', right: 10,
    backgroundColor: '#27AE60', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
    backgroundColor: '#FFF', borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 6,
    marginTop: 2,
  },
  suggestion: {
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  suggestionText: { fontSize: 15, color: '#1A2F5A' },
  spellRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center', gap: 6, marginTop: 6,
  },
  spellLabel: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },
  spellChip: {
    backgroundColor: '#FFF7E6', borderRadius: 14,
    borderWidth: 1, borderColor: '#F39C12',
    paddingHorizontal: 10, paddingVertical: 4,
  },
  spellChipText: { fontSize: 13, color: '#D35400', fontWeight: '500' },
});
