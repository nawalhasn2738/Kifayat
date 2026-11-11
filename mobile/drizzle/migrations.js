// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_unknown_karma.sql';
import m0001 from './0001_sticky_thundra.sql';
import m0002 from './0002_noisy_pretty_boy.sql';
import m0003 from './0003_nappy_revanche.sql';
import m0004 from './0004_big_cargill.sql';
import m0005 from './0005_deep_puma.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005
    }
  }
  