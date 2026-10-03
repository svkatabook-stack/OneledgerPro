import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests', testMatch:'**/cloud.spec.js', timeout:30000, workers:1,
 use:{baseURL:'http://127.0.0.1:5175',channel:'chrome',headless:true,trace:'retain-on-failure'},
 webServer:{command:'npm run dev -- --port 5175',url:'http://127.0.0.1:5175',reuseExistingServer:false,
 env:{VITE_APP_MODE:'cloud',VITE_SUPABASE_URL:'http://127.0.0.1:54399',VITE_SUPABASE_ANON_KEY:'sb_publishable_local_test_only'}},
});
