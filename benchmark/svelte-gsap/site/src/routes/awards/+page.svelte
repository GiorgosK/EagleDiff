<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Stats from "$lib/components/Stats.svelte";
	import Brands from "$lib/components/Brands.svelte";
	import Testimonials from "$lib/components/Testimonials.svelte";
	import Footer from "$lib/components/Footer.svelte";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Awards" title="Recognised" accent="work." intro="Forty-five international awards for design, motion and engineering." />
	<Stats />
	<Brands />
	<Testimonials />
	<Footer />
</div>
