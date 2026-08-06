import "@testing-library/jest-dom";

// 1. Mock Firebase Admin globally
// This prevents tests from trying to connect to a real project
jest.mock("firebase-admin/app", () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(),
  cert: jest.fn()
}));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    set: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  }))
}));

// 2. Mock the central env file to use our Proxy mock
// This ensures that importing { env } from "@/lib/env" never fails
jest.mock("./src/lib/env", () => ({
  env: new Proxy(
    {},
    {
      get: (target, prop) => process.env[prop] || `test_${String(prop)}`
    }
  )
}));

// 3. Silence specific console warnings that clutter test output
const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("Firebase: Error")) return;
  originalConsoleError(...args);
};
