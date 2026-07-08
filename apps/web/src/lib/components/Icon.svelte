<script lang="ts">
  import {
    Scale,
    FlaskConical,
    ClipboardCheck,
    BookOpen,
    Share2,
    ShieldCheck,
    ChartLine,
    LayoutTemplate,
    PencilLine,
    Search,
    Wrench,
    Database,
    Menu,
    Activity,
    SunMoon,
    ChevronDown,
    X,
    Plus,
    Upload,
    ArrowLeft,
    RefreshCw,
    Trash2,
    Circle,
    Play,
    KeyRound,
  } from '@lucide/svelte';

  interface Props {
    name: string;
    size?: number;
    strokeWidth?: number;
    class?: string;
  }
  let { name, size = 18, strokeWidth = 2, class: cls = '' }: Props = $props();

  const MAP: Record<string, typeof Circle> = {
    scale: Scale,
    workbench: FlaskConical,
    review: ClipboardCheck,
    knowledge: BookOpen,
    graph: Share2,
    validate: ShieldCheck,
    insights: ChartLine,
    prompts: LayoutTemplate,
    author: PencilLine,
    analyze: Search,
    operate: Wrench,
    data: Database,
    menu: Menu,
    status: Activity,
    theme: SunMoon,
    chevron: ChevronDown,
    close: X,
    plus: Plus,
    upload: Upload,
    back: ArrowLeft,
    refresh: RefreshCw,
    trash: Trash2,
    search: Search,
    runner: Play,
    demask: KeyRound,
    dot: Circle,
  };

  const Cmp = $derived(MAP[name] ?? Circle);
</script>

<Cmp {size} {strokeWidth} class={cls} />
