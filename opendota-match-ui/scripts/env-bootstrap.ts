/**
 * 必须在其它仓库模块之前导入，以便 `supabaseClient` 等读取到 `process.env`。
 */
import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(__dirname, "..");
config({ path: join(UI_ROOT, ".env.local") });
config({ path: join(UI_ROOT, "..", ".env.local") });
