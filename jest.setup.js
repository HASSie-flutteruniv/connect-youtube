// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock the TextEncoder/TextDecoder which are used in SSE implementation
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

// Mock localStorage
if (typeof window !== 'undefined') {
  // Browserの場合、mock不要
} else {
  // Node.jsの場合、localStorageをモック
  const localStorageMock = (function() {
    let store = {};
    return {
      getItem(key) {
        return store[key] || null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
      clear() {
        store = {};
      }
    };
  })();
  
  Object.defineProperty(global, 'localStorage', {
    value: localStorageMock
  });
}

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    };
  },
  useSearchParams() {
    return {
      get: jest.fn(),
    };
  },
  usePathname() {
    return '';
  },
})); 