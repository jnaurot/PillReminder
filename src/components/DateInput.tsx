import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, type StyleProp, type ViewStyle,
} from 'react-native';

// Positions in 'YYYY-MM-DD' that are digit slots
const TEMPLATE = 'YYYY-MM-DD';
const DIGIT_POSITIONS = [0, 1, 2, 3, 5, 6, 8, 9];

interface Props {
  value: string; // stored as 'YYYY-MM-DD' or ''
  onChange: (iso: string) => void;
  style?: StyleProp<ViewStyle>;
}

function isoToDigits(iso: string): string {
  return iso.replace(/\D/g, '').slice(0, 8);
}

function digitsToIso(digits: string): string {
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export default function DateInput({ value, onChange, style }: Props) {
  const [digits, setDigits] = useState(() => isoToDigits(value));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Sync when parent value changes (e.g. edit screen loads existing data)
  useEffect(() => {
    setDigits(isoToDigits(value));
  }, [value]);

  function handleChange(text: string) {
    const next = text.replace(/\D/g, '').slice(0, 8);
    setDigits(next);
    onChange(digitsToIso(next));
  }

  // Index in TEMPLATE where the cursor should appear
  const cursorTemplatePos =
    digits.length < DIGIT_POSITIONS.length ? DIGIT_POSITIONS[digits.length] : -1;

  return (
    <TouchableOpacity
      activeOpacity={1}
      style={[styles.container, style, focused && styles.containerFocused]}
      onPress={() => inputRef.current?.focus()}
    >
      {/* Hidden input — holds only the raw digits, invisible to user */}
      <TextInput
        ref={inputRef}
        value={digits}
        onChangeText={handleChange}
        keyboardType="numeric"
        maxLength={8}
        caretHidden
        style={styles.hiddenInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      {/* Visual template */}
      <View style={styles.display} pointerEvents="none">
        {TEMPLATE.split('').map((ch, i) => {
          if (ch === '-') {
            return (
              <Text key={i} style={styles.dash}>-</Text>
            );
          }

          const digitIndex = DIGIT_POSITIONS.indexOf(i);
          const isFilled = digitIndex < digits.length;
          const isCursor = focused && i === cursorTemplatePos;

          return (
            <View key={i} style={styles.slot}>
              <Text style={isFilled ? styles.filledChar : styles.emptyChar}>
                {isFilled ? digits[digitIndex] : ch}
              </Text>
              {isCursor && <View style={styles.cursor} />}
            </View>
          );
        })}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  containerFocused: {
    borderColor: '#4A90D9',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  display: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slot: {
    alignItems: 'center',
    position: 'relative',
  },
  filledChar: {
    fontSize: 18,
    color: '#1A2F5A',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  emptyChar: {
    fontSize: 18,
    color: '#CBD5E1',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  dash: {
    fontSize: 18,
    color: '#94A3B8',
    marginHorizontal: 1,
    fontVariant: ['tabular-nums'],
  },
  cursor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#4A90D9',
    borderRadius: 1,
  },
});
