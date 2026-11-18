<script setup lang="ts">
import type { StageRecorder } from "../model/recorder";
import { clock } from "../../../shared/math";
defineProps<{ recorder: StageRecorder }>();
defineEmits<{ start: [] }>();
</script>
<template>
  <section class="panel record-panel">
    <div class="panel-heading">
      <span>05 / CAPTURE SESSION</span><span>1280 × 720</span>
    </div>
    <div class="record-top">
      <div>
        <strong>把现场留住。</strong
        ><small>舞台画面 + 音频 · 30 FPS · 暂停不中断音乐与舞台</small>
      </div>
      <span
        class="record-clock"
        :class="{ paused: recorder.state.status === 'paused' }"
        >{{ clock(recorder.state.filmElapsed) }}</span
      >
    </div>
    <div class="record-clocks">
      <span
        >现场时长 <b>{{ clock(recorder.state.liveElapsed) }}</b></span
      ><span
        >成片时长 <b>{{ clock(recorder.state.filmElapsed) }}</b>
        <i v-if="recorder.state.status === 'paused'">已暂停</i></span
      >
    </div>
    <div class="record-actions">
      <button
        v-if="recorder.state.status === 'idle'"
        class="record-button"
        @click="$emit('start')"
      >
        <span></span>开始录制
      </button>
      <template v-else>
        <button
          class="record-button"
          :disabled="recorder.state.status === 'saving'"
          @click="recorder.state.status === 'paused' ? recorder.resume() : recorder.pause()"
        >
          <span></span
          >{{
            recorder.state.status === "paused"
              ? "继续录制"
              : recorder.state.status === "saving"
                ? "正在保存…"
                : "暂停录制"
          }}
        </button>
        <button
          class="mark-button"
          :disabled="recorder.state.status === 'saving'"
          @click="recorder.mark()"
        >
          场记 <kbd>M</kbd>
        </button>
        <button
          class="stop-button"
          :disabled="recorder.state.status === 'saving'"
          @click="recorder.stop()"
        >
          停止
        </button>
      </template>
    </div>
    <div v-if="recorder.state.markers.length" class="live-cues">
      <small
        v-for="m in recorder.state.markers"
        :key="m.id"
        :class="m.kind"
      >
        {{ m.label }} · 音乐 {{ clock(m.music) }} ·
        <template v-if="m.kind === 'kept'"
          >成片 {{ clock(m.film ?? 0) }} · 保留</template
        >
        <template v-else>落在暂停区间 · 将被剪去</template>
      </small>
    </div>
    <p v-if="recorder.state.error" role="alert">{{ recorder.state.error }}</p>
    <small class="muted"
      >暂停期间可照常切主题、换场景、黑场；继续后从当前现场接上，不补录漏掉的时间</small
    >
  </section>
</template>
