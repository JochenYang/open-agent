/**
 * OpenCode 声音提醒插件
 * 功能：在每次 AI 回复结束时（session.idle）播放提示音
 */

const SOUND_FILE = "C:\\Users\\Administrator\\.config\\opencode\\sounds\\finish.wav";

export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await playSound($);
      }
    },
  }
};

async function playSound($) {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS
    await $`afplay "${SOUND_FILE.replace(/\\/g, "/")}"`;
  } else if (platform === "win32") {
    // Windows - 使用 PowerShell 播放 wav 文件
    await $`powershell -NoProfile -Command "[System.Media.SoundPlayer]::new('${SOUND_FILE.replace(/\\/g, "\\\\")}').PlaySync()"`;
  } else {
    // Linux
    await $`aplay "${SOUND_FILE}" 2>/dev/null || paplay "${SOUND_FILE}" 2>/dev/null`;
  }
}
