// ⚠️ 自动生成，请勿直接编辑。
// 源文件：frontend-shared/utils/sessionListView.js
// 同步：npm run sync:shared（frontend-vue2 / frontend 各自目录下执行）
export function groupedSessions(sessions) {
      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const weekAgo = startOfToday - 7 * 24 * 60 * 60 * 1000

      const pinned = []
      const today = []
      const week = []
      const earlier = []

      for (const s of sessions) {
        if (s.pinned) {
          pinned.push(s)
          continue
        }
        const ts = new Date(s.updated_at || s.created_at || Date.now()).getTime()
        if (ts >= startOfToday) {
          today.push(s)
        } else if (ts >= weekAgo) {
          week.push(s)
        } else {
          earlier.push(s)
        }
      }

      const groups = []
      if (pinned.length) groups.push({ label: '置顶', sessions: pinned })
      if (today.length) groups.push({ label: '今天', sessions: today })
      if (week.length) groups.push({ label: '最近一周', sessions: week })
      if (earlier.length) groups.push({ label: '更早', sessions: earlier })
      return groups
}

export function userInitials(username) {
      const name = username || '用户'
      if (!name) return 'U'
      // 中文：取前两个字符
      const chineseChars = name.match(/[\u4e00-\u9fff]/g)
      if (chineseChars && chineseChars.length > 0) {
        // 简单取前两个中文字符（拼音首字母需引入拼音库，这里用字符本身的大写映射）
        // 常见姓氏首字母映射表（覆盖常见情况）
        const pinyinMap = {
          '张': 'Z', '王': 'W', '李': 'L', '刘': 'L', '陈': 'C', '杨': 'Y', '赵': 'Z', '黄': 'H',
          '周': 'Z', '吴': 'W', '徐': 'X', '孙': 'S', '胡': 'H', '朱': 'Z', '高': 'G', '林': 'L',
          '何': 'H', '郭': 'G', '马': 'M', '罗': 'L', '梁': 'L', '宋': 'S', '郑': 'Z', '谢': 'X',
          '韩': 'H', '唐': 'T', '冯': 'F', '于': 'Y', '董': 'D', '萧': 'X', '程': 'C', '曹': 'C',
          '袁': 'Y', '邓': 'D', '许': 'X', '傅': 'F', '沈': 'S', '曾': 'Z', '彭': 'P', '吕': 'L',
          '苏': 'S', '卢': 'L', '蒋': 'J', '蔡': 'C', '贾': 'J', '丁': 'D', '魏': 'W', '薛': 'X',
          '叶': 'Y', '阎': 'Y', '余': 'Y', '潘': 'P', '杜': 'D', '戴': 'D', '夏': 'X', '钟': 'Z',
          '汪': 'W', '田': 'T', '任': 'R', '姜': 'J', '范': 'F', '方': 'F', '石': 'S', '姚': 'Y',
          '谭': 'T', '廖': 'L', '邹': 'Z', '熊': 'X', '金': 'J', '陆': 'L', '郝': 'H', '孔': 'K',
          '白': 'B', '崔': 'C', '康': 'K', '毛': 'M', '邱': 'Q', '秦': 'Q', '江': 'J', '史': 'S',
          '顾': 'G', '侯': 'H', '邵': 'S', '孟': 'M', '龙': 'L', '万': 'W', '段': 'D', '雷': 'L',
          '钱': 'Q', '汤': 'T', '尹': 'Y', '黎': 'L', '易': 'Y', '常': 'C', '武': 'W', '乔': 'Q',
          '贺': 'H', '赖': 'L', '龚': 'G', '文': 'W', '用户': 'Y'
        }
        const chars = chineseChars.slice(0, 2)
        let initials = ''
        for (const ch of chars) {
          initials += pinyinMap[ch] || ch
        }
        return initials.toUpperCase() || name.substring(0, 2).toUpperCase()
      }
      // 英文/其他：取前两个字母大写
      const letters = name.replace(/[^a-zA-Z]/g, '')
      if (letters.length >= 2) {
        return letters.substring(0, 2).toUpperCase()
      }
      return name.substring(0, 2).toUpperCase()
}

export function sessionCreatedAt(sessions, sessionId) {
  if (!sessionId) return null
  return sessions.find(s => s.session_id === sessionId)?.created_at || null
}
