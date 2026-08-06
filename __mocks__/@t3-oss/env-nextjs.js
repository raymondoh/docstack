// This Proxy handles any access to the env object during tests
// without requiring the actual Zod validation to run.
module.exports = {
  createEnv: config => {
    return new Proxy(
      {},
      {
        get: (target, prop) => {
          // Return the property from process.env if it exists,
          // otherwise return a dummy string for testing.
          return process.env[prop] || `mock_${String(prop)}`;
        }
      }
    );
  }
};
