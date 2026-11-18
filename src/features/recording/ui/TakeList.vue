<script setup lang="ts">
import type { StageRecorder } from "../model/recorder";
import { clock, download } from "../../../shared/math";
defineProps<{ recorder: StageRecorder }>();
</script>
<template>
  <section class="take-list">
    <div class="panel-heading">
      <span>SESSION TAKES</span
      ><span>{{
        recorder.state.takes.length.toString().padStart(2, "0")
      }}</span>
    </div>
    <p v-if="!recorder.state.takes.length" class="muted">
      还没有录制片段。下一场演出，值得被记住。
    </p>
    <div v-for="(t, i) in recorder.state.takes" :key="t.id" class="take">
      <span>↗</span>
      <div class="take-body">
        <strong>Take {{ recorder.state.takes.length - i }}</strong>
        <small>
          成片 {{ clock(t.duration) }} · 现场 {{ clock(t.liveDuration) }} ·
          音乐起 {{ clock(t.startMusic) }} ·
          {{ (t.size / 1024 / 1024).toFixed(2) }} MB
        </small>
        <div v-if="t.markers.length" class="take-cues">
          <small
            v-for="m in t.markers"
            :key="m.id"
            :class="['cue', m.kind]"
          >
            {{ m.label }} · 音乐 {{ clock(m.music) }} ·
            <template v-if="m.kind === 'kept'"
              >成片 {{ clock(m.film ?? 0) }}（保留）</template
            >
            <template v-else>剪去区间（无成片位置）</template>
          </small>
        </div>
        <div class="take-downloads">
          <button
            :disabled="recorder.state.buildingId === t.id"
            @click="download(t.url, t.name)"
          >
            下载成片（去暂停）
          </button>
          <button
            :disabled="recorder.state.buildingId === t.id"
            @click="recorder.downloadFull(t.id)"
          >
            {{
              recorder.state.buildingId === t.id
                ? "生成现场版…"
                : "下载完整现场"
            }}
          </button>
          <button
            class="take-remove"
            aria-label="删除录制"
            @click="recorder.remove(t.id)"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
