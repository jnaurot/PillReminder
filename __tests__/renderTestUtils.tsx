import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
if (!(globalThis as any).__pillReminderRenderTestConsolePatched) {
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
      return;
    }
    originalConsoleError(...args);
  };
  (globalThis as any).__pillReminderRenderTestConsolePatched = true;
}

export function createReactNativeMock() {
  const createHost = (name: string) => {
    const Host = ({ children, ...props }: any) => React.createElement(name, props, children);
    Host.displayName = name;
    return Host;
  };

  const View = createHost('View');
  const Text = createHost('Text');
  const ScrollView = createHost('ScrollView');
  const ActivityIndicator = createHost('ActivityIndicator');
  const RefreshControl = createHost('RefreshControl');
  const KeyboardAvoidingView = createHost('KeyboardAvoidingView');
  const TextInput = createHost('TextInput');
  const Modal = ({ visible, children, ...props }: any) =>
    visible ? React.createElement('Modal', props, children) : null;

  const TouchableOpacity = ({ children, ...props }: any) =>
    React.createElement('TouchableOpacity', props, children);

  const SectionList = React.forwardRef<any, any>(function MockSectionList(
    { sections = [], renderSectionHeader, renderItem, ListEmptyComponent, ...props },
    ref,
  ) {
    const scrollToLocation = jest.fn();
    React.useImperativeHandle(ref, () => ({ scrollToLocation }));

    return React.createElement(
      'SectionList',
      props,
      sections.length === 0 && ListEmptyComponent
        ? React.createElement(ListEmptyComponent)
        : null,
      sections.map((section: any, sectionIndex: number) =>
        React.createElement(
          React.Fragment,
          { key: `section-${sectionIndex}` },
          renderSectionHeader ? renderSectionHeader({ section }) : null,
          (section.data ?? []).map((item: any, itemIndex: number) =>
            React.createElement(
              React.Fragment,
              { key: `${sectionIndex}-${itemIndex}` },
              renderItem ? renderItem({ item, index: itemIndex, section }) : null,
            ),
          ),
        ),
      ),
    );
  });

  return {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    SectionList,
    ActivityIndicator,
    RefreshControl,
    KeyboardAvoidingView,
    TextInput,
    Modal,
    StyleSheet: { create: (styles: any) => styles },
    SafeAreaView: createHost('SafeAreaView'),
    Platform: { OS: 'ios' },
    Alert: { alert: jest.fn() },
    Keyboard: { dismiss: jest.fn() },
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    NativeModules: {},
    Vibration: { vibrate: jest.fn() },
  };
}

export function createSafeAreaContextMock() {
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    SafeAreaProvider: ({ children, ...props }: any) => React.createElement('SafeAreaProvider', props, children),
  };
}

export async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

export function nodeText(node: ReactTestInstance): string {
  return flattenChildren(node.props.children);
}

export function flattenChildren(value: any): string {
  if (Array.isArray(value)) return value.map(flattenChildren).join('');
  if (value == null || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

export function findTextNode(root: ReactTestInstance, text: string): ReactTestInstance {
  const match = root.findAll((node) => (node.type as any) === 'Text' && nodeText(node).includes(text))[0];
  if (!match) throw new Error(`Could not find text node containing: ${text}`);
  return match;
}

export function findAncestorWithProp(node: ReactTestInstance, propName: string): ReactTestInstance {
  let current: ReactTestInstance | null = node;
  while (current) {
    if (current.props && typeof current.props[propName] === 'function') return current;
    current = current.parent;
  }
  throw new Error(`Could not find ancestor with prop: ${propName}`);
}
