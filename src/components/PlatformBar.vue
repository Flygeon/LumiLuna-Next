<script setup lang="ts">
/**
 * 音乐页「平台条」——在线平台的一级导航，兼作账号入口。
 *
 * ## 与内容域（为你推荐 / 歌单 / 搜索）的层级区分
 *
 * 两级都用胶囊会让用户分不清父子，因此这里靠三条互不重叠的维度拉开层次：
 *   1. 容器：本条是 `surface-container-low` 横条；内容域是裸胶囊分段（无容器）
 *   2. 色彩：品牌色只出现在本条（圆点、选中描边），内容域只用 secondary-container
 *   3. 账号：头像 / 昵称 / 退出只挂在本条
 *
 * 交互上两级正交：平台 = 数据来源，内容域 = 视图。切换平台时内容域保持不变
 * （由父组件负责），只有详情页会退回根列表。
 *
 * 仅在已启用平台 ≥ 2 时由父组件渲染；单平台时账号部分等价于改造前的账号条。
 */
import { computed } from "vue";
import CachedCover from "@/components/CachedCover.vue";
import { useSettingsStore } from "@/stores/settings";
import { useNeteaseStore } from "@/stores/netease";
import { useKugouStore } from "@/stores/kugou";
import { translate } from "@shared/i18n";
import type { MusicServer } from "@shared/types";

const props = defineProps<{ server: MusicServer }>();
const emit = defineEmits<{ (e: "update:server", value: MusicServer): void }>();

const settings = useSettingsStore();
const netease = useNeteaseStore();
const kugou = useKugouStore();

function t(key: string) {
  return translate(settings.lang, key);
}

/** 品牌色：只用于平台条自身的强调（圆点 / 选中描边），不污染 MD3 主色 */
const PLATFORM_ACCENT: Record<MusicServer, string> = {
  netease: "#C20C0C",
  kugou: "#0FA9F5",
};

const servers = computed(() => settings.enabledServers);

function platformName(server: MusicServer): string {
  return t(`settings.onlineServer_${server}`);
}

function loggedIn(server: MusicServer): boolean {
  return server === "netease" ? netease.loggedIn : kugou.loggedIn;
}

/** 当前平台账号展示信息（两家字段不同，这里统一成头像 + 昵称） */
function accountOf(server: MusicServer): { avatar: string; nickname: string } {
  if (server === "netease") {
    return {
      avatar: netease.profile?.avatarUrl ?? "",
      nickname: netease.profile?.nickname ?? "",
    };
  }
  return {
    avatar: kugou.profile?.avatar ?? "",
    nickname: kugou.profile?.nickname ?? "",
  };
}

function loginLabel(server: MusicServer): string {
  return server === "netease" ? t("netease.login") : t("kugou.login");
}

function logoutLabel(server: MusicServer): string {
  return server === "netease" ? t("netease.logout") : t("kugou.logout");
}

function loginHint(server: MusicServer): string {
  return server === "netease" ? t("netease.loginHint") : t("kugou.loginHint");
}

function openLogin(server: MusicServer) {
  if (server === "netease") netease.openQr();
  else kugou.openQr();
}

function doLogout(server: MusicServer) {
  if (server === "netease") void netease.logout();
  else void kugou.logout();
}

const currentAccount = computed(() => accountOf(props.server));
</script>

<template>
  <div class="platform-bar">
    <template v-if="servers.length > 1">
      <div class="platforms" role="group" :aria-label="t('settings.onlineServer')">
        <button
          v-for="s in servers"
          :key="s"
          class="p-chip"
          :class="{ active: s === server }"
          :style="{ '--p-accent': PLATFORM_ACCENT[s] }"
          :aria-pressed="s === server"
          @click="emit('update:server', s)"
        >
          <span class="p-dot" aria-hidden="true"></span>
          <span class="p-name">{{ platformName(s) }}</span>
          <!-- 登录态指示：已登录为品牌色实心点，未登录为空心圈 -->
          <span class="p-state" :class="{ on: loggedIn(s) }" aria-hidden="true"></span>
        </button>
      </div>

      <span class="p-divider" aria-hidden="true"></span>
    </template>

    <div class="account">
      <template v-if="loggedIn(server)">
        <CachedCover
          v-if="currentAccount.avatar"
          :url="currentAccount.avatar"
          class="avatar"
          alt=""
        />
        <span v-else class="avatar placeholder">
          <span class="material-symbols-outlined">person</span>
        </span>
        <span class="nickname">{{ currentAccount.nickname }}</span>
        <m3e-button variant="text" size="small" @click="doLogout(server)">
          <span slot="icon" class="material-symbols-outlined">logout</span>
          {{ logoutLabel(server) }}
        </m3e-button>
      </template>
      <template v-else>
        <span class="avatar placeholder">
          <span class="material-symbols-outlined">person</span>
        </span>
        <span class="nickname account-hint">{{ loginHint(server) }}</span>
        <m3e-button variant="tonal" size="small" @click="openLogin(server)">
          <span slot="icon" class="material-symbols-outlined">qr_code</span>
          {{ loginLabel(server) }}
        </m3e-button>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 层级维度①：容器——横条 vs 内容域的裸胶囊 */
.platform-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 14px;
  background: var(--md-sys-color-surface-container-low);
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}

.platforms {
  display: inline-flex;
  gap: 3px;
  min-width: 0;
}

.p-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px 5px 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast),
    color var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast);
}
.p-chip:hover {
  background: var(--md-sys-color-surface-container-high);
}

/* 层级维度②：品牌色只在这一级出现（圆点 + 选中描边） */
.p-chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  box-shadow: inset 0 0 0 1.5px var(--p-accent);
}

.p-dot {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--p-accent);
}

.p-name {
  white-space: nowrap;
}

.p-state {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--md-sys-color-outline);
}
.p-state.on {
  border: none;
  background: var(--p-accent);
}

.p-divider {
  flex: none;
  width: 1px;
  height: 20px;
  background: var(--md-sys-color-outline-variant);
}

/* 层级维度③：账号只挂在这一级 */
.account {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.avatar {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}
.avatar.placeholder .material-symbols-outlined {
  font-size: 19px;
}

.nickname {
  min-width: 0;
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-hint {
  font-weight: 400;
  color: var(--md-sys-color-on-surface-variant);
}

.account m3e-button {
  flex: none;
  margin-left: auto;
}

/* 窄窗：账号区整块换行，不出现横向滚动 */
@media (max-width: 720px) {
  .platform-bar {
    border-radius: var(--md-sys-shape-corner-extra-large);
  }
  .account {
    flex-basis: 100%;
  }
  .p-divider {
    display: none;
  }
}
</style>
