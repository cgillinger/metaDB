-- Remove the TikTok feature: delete all TikTok data and drop the daily table.
-- FK is OFF during migrations, so child rows (posts) are deleted explicitly.
DELETE FROM posts WHERE platform = 'tiktok';
DELETE FROM imports WHERE platform = 'tiktok';
DELETE FROM hidden_accounts WHERE platform LIKE 'tiktok%';
DROP TABLE IF EXISTS tiktok_account_daily;
