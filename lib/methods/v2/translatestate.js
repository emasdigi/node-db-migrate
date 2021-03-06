const Promise = require('bluebird');
const State = require('../../state');
const Chain = require('../../chain');
const Migrate = require('./migrate');
const Learn = require('../../learn');

const methods = {
  createTable: async (driver, [t], internals) => {
    const mod = internals.modSchema;
    const schema = mod.c[t];
    await driver.createTable(t, schema);

    Object.keys(schema).forEach(key => {
      if (schema[key].foreignKey) {
        delete mod.f[t][schema[key].foreignKey.name];
      }
    });

    if (mod.i[t]) {
      await Promise.resolve(Object.keys(mod.i[t])).each(i => {
        const index = mod.i[t][i];
        return driver.addIndex(t, i, index.c, index.u);
      });
    }

    if (mod.f[t]) {
      await Promise.resolve(Object.keys(mod.f[t])).each(f => {
        const foreign = mod.f[t][f];
        return driver.addForeignKey(
          t,
          foreign.rt,
          foreign.k,
          foreign.m,
          foreign.r
        );
      });
    }
  },

  addColumn: async (driver, [t, c], internals) => {
    return driver.addColumn(t, c, internals.modSchema.c[t][c]);
  },

  changeColumn: async (driver, [t, c], internals) => {
    return driver.changeColumn(t, c, internals.modSchema.c[t][c]);
  }
};

async function processEntry (
  context,
  file,
  driver,
  internals,
  { t: type, a: action, c: args }
) {
  const f = Object.assign(methods, context.reverse);
  switch (type) {
    case 0:
      await driver[action].apply(driver, args);
      break;
    case 1:
      await f[action](driver, args, internals);
      break;

    default:
      throw new Error(`Invalid state record, of type ${type}`);
  }

  internals.modSchema.s.shift();
  await State.update(context, file, internals.modSchema, internals);
}

module.exports = async (context, file, driver, internals) => {
  const mod = internals.modSchema;

  const chain = new Chain(context, file, driver, internals);
  chain.addChain(Learn);
  chain.addChain(Migrate);
  await Promise.resolve(mod.s.reverse()).each(args =>
    processEntry(context, file, chain, internals, args)
  );

  await State.deleteState(context, file, internals);
};
