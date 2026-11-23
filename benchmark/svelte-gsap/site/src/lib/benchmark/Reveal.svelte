<script>
	import { onMount } from "svelte";
	import gsap from "gsap";
	import ScrollTrigger from "gsap/ScrollTrigger";

	let { children, className = "" } = $props();
	let ref = $state();

	onMount(() => {
		gsap.registerPlugin(ScrollTrigger);
		gsap.from(ref, { y: 40, autoAlpha: 0, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: ref, start: "top 85%" } });
	});
</script>

<div bind:this={ref} class={className}>{@render children()}</div>
