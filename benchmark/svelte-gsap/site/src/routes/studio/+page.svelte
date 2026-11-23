<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Manifesto from "$lib/components/Manifesto.svelte";
	import Stats from "$lib/components/Stats.svelte";
	import Testimonials from "$lib/components/Testimonials.svelte";
	import Footer from "$lib/components/Footer.svelte";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Studio" title="A small studio" accent="for big ideas." intro="Twelve designers and engineers in one room, building digital experiences that move." />
	<Manifesto />
	<Stats />
	<Testimonials />
	<Footer />
</div>
