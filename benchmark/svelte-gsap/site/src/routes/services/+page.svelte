<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Showcase from "$lib/components/Showcase.svelte";
	import Faq from "$lib/components/Faq.svelte";
	import Footer from "$lib/components/Footer.svelte";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Services" title="What we" accent="build." intro="Strategy, motion identity and engineering, from the first sketch to launch day." />
	<Showcase />
	<Faq />
	<Footer />
</div>
