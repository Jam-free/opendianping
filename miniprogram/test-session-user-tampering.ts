#!/usr/bin/env tsx
/**
 * 测试 session_user 篡改风险
 */

console.log('session_user 篡改风险测试');
console.log('========================\n');

console.log('客户端 Storage 结构：');
const fakeSessionUser = {
  id: 'fake-uuid-12345',     // 客户端可以随意篡改
  nickname: '我是假用户',
  avatar: 'http://fake.com/avatar.jpg'
};
console.log(JSON.stringify(fakeSessionUser, null, 2));

console.log('\n问题：');
console.log('1. ❌ id 是内部UUID，不是 openid');
console.log('2. ❌ 客户端可以篡改这个值');
console.log('3. ❌ 如果旧库映射丢失，无法验证真实微信身份');
console.log('4. ❌ 恶意用户可以伪造他人 id 窃取数据');

console.log('\n服务端数据库 users 表：');
console.log(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,      -- 内部UUID
    openid TEXT UNIQUE,       -- 微信 OpenID（可信）
    nickname TEXT,
    avatar TEXT
  );
`);

console.log('正确的身份验证流程：');
console.log('1. ✅ 用户通过微信登录（wx.login）');
console.log('2. ✅ 服务端从微信网关获取 openid（可信）');
console.log('3. ✅ 服务端根据 openid 查找或创建用户');
console.log('4. ✅ 返回 session_token（可验证）');
console.log('5. ❌ 客户端的 session_user.id 仅供展示，不可信');

console.log('\n恢复数据时的问题：');
console.log('❌ 不能凭客户端 session_user.id 认领数据');
console.log('❌ 不能凭昵称匹配（可重名、可改名）');
console.log('✅ 必须通过服务端登录流程获取可信 openid');
console.log('✅ 然后用 openid 在备份中查找该用户的数据');

console.log('\n如果备份中 openid 映射丢失：');
console.log('❌ 无法证明客户端用户的真实微信身份');
console.log('❌ 无法安全恢复数据');
console.log('⚠️  只能让用户重新登录，不恢复旧数据');
