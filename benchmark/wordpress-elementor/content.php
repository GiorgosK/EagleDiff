<?php
/**
 * Deterministic Elementor demo content for the benchmark (run with wp eval-file).
 *
 * Pages are built from Elementor's free widgets: animated headings, Swiper
 * carousels, counters, progress bars, tabs, accordions, toggles, icon boxes,
 * galleries and lazy-loaded background images. Images come from the Twenty
 * Twenty-Five theme that ships with WordPress, so every install renders the
 * same pages.
 */

foreach (get_posts(['post_type' => ['post', 'page'], 'post_status' => 'any', 'numberposts' => -1]) as $old) {
  wp_delete_post($old->ID, TRUE);
}
update_option('blogname', 'Lumen');
update_option('blogdescription', 'Garden design studio');
update_option('permalink_structure', '/%postname%/');

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

$images = [];
foreach ([
  'red-hibiscus-closeup.webp', 'delphinium-flowers.webp', 'botany-flowers.webp', 'northern-buttercups-flowers.webp',
  'campanula-alliariifolia-flower.webp', 'star-thristle-flower.webp', 'category-sunflowers.webp', 'category-cactus.webp',
  'man-in-hat.webp', 'nurse.webp', 'woman-splashing-water.webp', 'flower-meadow-square.webp',
] as $file) {
  $source = ABSPATH . 'wp-content/themes/twentytwentyfive/assets/images/' . $file;
  $copy = wp_tempnam($file);
  copy($source, $copy);
  $id = media_handle_sideload(['name' => $file, 'tmp_name' => $copy], 0);
  if (is_wp_error($id)) {
    throw new RuntimeException($id->get_error_message());
  }
  $images[] = ['id' => $id, 'url' => wp_get_attachment_url($id)];
}

// Stable element ids: the same content always gets the same ids.
$counter = 0;
$next_id = function () use (&$counter) {
  return substr(md5('element-' . $counter++), 0, 7);
};
$widget = function (string $type, array $settings) use ($next_id) {
  return ['id' => $next_id(), 'elType' => 'widget', 'widgetType' => $type, 'settings' => $settings, 'elements' => []];
};
$box = function (array $settings, array $elements) use ($next_id) {
  return ['id' => $next_id(), 'elType' => 'container', 'isInner' => FALSE,
    'settings' => $settings + ['content_width' => 'boxed'], 'elements' => $elements];
};
$row = fn(array $elements) => $box(['flex_direction' => 'row', 'flex_wrap' => 'wrap'], $elements);
$column = fn(array $elements) => $box(['flex_direction' => 'column', 'width' => ['unit' => '%', 'size' => 30]], $elements);
$heading = fn(string $title, string $size = 'h2', array $more = []) => $widget('heading', ['title' => $title, 'header_size' => $size] + $more);
$text = fn(string $html) => $widget('text-editor', ['editor' => "<p>$html</p>"]);
$button = fn(string $label) => $widget('button', ['text' => $label, 'link' => ['url' => '#']]);
$hero = fn(string $title, int $image) => $box([
  'background_background' => 'classic', 'background_image' => $images[$image], 'background_size' => 'cover',
  'background_position' => 'center center', 'min_height' => ['unit' => 'px', 'size' => 380],
  'justify_content' => 'center',
], [
  $heading($title, 'h1', ['_animation' => 'fadeInUp', 'title_color' => '#ffffff']),
  $button('Get in touch'),
]);
$paragraph = 'We design gardens that are easy to care for and full of life through every season. Every project starts with the soil, the light and the way you want to use the space.';
$icon = fn(string $name) => ['value' => "fas fa-$name", 'library' => 'fa-solid'];
$icon_box = fn(string $name, string $title) => $widget('icon-box', ['selected_icon' => $icon($name), 'title_text' => $title, 'description_text' => 'Planning, planting and care from one small team.']);
$counter_widget = fn(int $to, string $title) => $widget('counter', ['starting_number' => 0, 'ending_number' => $to, 'title' => $title, 'thousand_separator' => 'yes']);
$progress = fn(string $title, int $percent) => $widget('progress', ['title' => $title, 'percent' => ['unit' => '%', 'size' => $percent], 'inner_text' => '']);
$items = fn(array $titles) => array_map(fn($title) => ['tab_title' => $title, 'tab_content' => "<p>$paragraph</p>"], $titles);
$carousel = fn(array $picks) => $widget('image-carousel', [
  'carousel' => array_map(fn($i) => $images[$i], $picks), 'slides_to_show' => '3', 'autoplay' => 'yes',
  'autoplay_speed' => 2500, 'navigation' => 'both', 'infinite' => 'yes', 'thumbnail_size' => 'medium',
]);
$image_box = fn(int $image, string $title) => $widget('image-box', ['image' => $images[$image], 'title_text' => $title, 'description_text' => 'Garden designer']);
$price = fn(string $plan, string $amount) => $column([
  $heading($plan, 'h3'), $heading($amount, 'h2'),
  $widget('icon-list', ['icon_list' => [
    ['text' => 'Site visit', 'selected_icon' => $icon('check')],
    ['text' => 'Planting plan', 'selected_icon' => $icon('check')],
    ['text' => 'Seasonal care', 'selected_icon' => $icon('check')],
  ]]),
  $button('Choose ' . $plan),
]);
$testimonial = fn(string $name, int $image) => $widget('testimonial', [
  'testimonial_content' => 'They turned a bare yard into a garden we use every day.', 'testimonial_name' => $name,
  'testimonial_job' => 'Client', 'testimonial_image' => $images[$image],
]);

$pages = [
  'home' => ['Home', [
    $hero('Gardens that grow with you', 0),
    $row([$column([$icon_box('seedling', 'Planting')]), $column([$icon_box('water', 'Watering')]), $column([$icon_box('sun', 'Light')])]),
    $row([$column([$counter_widget(1200, 'Plants')]), $column([$counter_widget(85, 'Gardens')]), $column([$counter_widget(12, 'Years')])]),
    $box([], [$carousel([1, 2, 3, 4, 5])]),
    $box([], [$testimonial('Maria P.', 9), $button('See our work')]),
  ]],
  'services' => ['Services', [
    $heading('What we do', 'h1'),
    $row([$column([$icon_box('leaf', 'Design')]), $column([$icon_box('tree', 'Trees')]), $column([$icon_box('spa', 'Care')])]),
    $row([$column([$icon_box('tint', 'Irrigation')]), $column([$icon_box('tools', 'Building')]), $column([$icon_box('recycle', 'Compost')])]),
    $box([], [$widget('accordion', ['tabs' => $items(['Small gardens', 'Roof terraces', 'Schools'])])]),
  ]],
  'about' => ['About', [
    $hero('About Lumen', 3),
    $row([$column([$widget('image', ['image' => $images[8]])]), $box(['width' => ['unit' => '%', 'size' => 60]], [$heading('Our story'), $text($paragraph)])]),
    $row([$column([$counter_widget(1200, 'Plants grown')]), $column([$counter_widget(340, 'Trees planted')]), $column([$counter_widget(98, 'Happy clients')])]),
  ]],
  'gallery' => ['Gallery', [
    $heading('Recent gardens', 'h1'),
    $box([], [$carousel([0, 1, 2, 3, 4, 5, 6])]),
    $box([], [$widget('image-gallery', ['wp_gallery' => array_map(fn($i) => $images[$i], [6, 7, 10, 11, 1, 3]), 'gallery_columns' => '3', 'thumbnail_size' => 'medium'])]),
  ]],
  'team' => ['Team', [
    $heading('Meet the team', 'h1'),
    $row([$column([$image_box(8, 'Nikos')]), $column([$image_box(9, 'Anna')]), $column([$image_box(10, 'Eleni')])]),
    $box([], [$text($paragraph)]),
  ]],
  'pricing' => ['Pricing', [
    $heading('Plans', 'h1'),
    $row([$price('Seed', '€90'), $price('Sprout', '€190'), $price('Bloom', '€390')]),
  ]],
  'faq' => ['FAQ', [
    $heading('Questions', 'h1'),
    $box([], [$widget('accordion', ['tabs' => $items(['Shipping plants', 'Watering schedules', 'Winter care', 'Pets and plants'])])]),
    $box([], [$widget('toggle', ['tabs' => $items(['Do you work in winter?', 'Can I see a garden?'])])]),
  ]],
  'process' => ['Process', [
    $heading('How we work', 'h1'),
    $box([], [$widget('tabs', ['tabs' => $items(['Visit', 'Design', 'Planting'])])]),
    $box([], [$text($paragraph)]),
  ]],
  'contact' => ['Contact', [
    $heading('Contact us', 'h1'),
    $row([
      $column([$widget('icon-list', ['icon_list' => [
        ['text' => '+30 210 000 0000', 'selected_icon' => $icon('phone')],
        ['text' => 'hello@example.com', 'selected_icon' => $icon('envelope')],
        ['text' => 'Athens, Greece', 'selected_icon' => $icon('map-marker-alt')],
      ]])]),
      $column([$widget('social-icons', ['social_icon_list' => [
        ['social_icon' => ['value' => 'fab fa-facebook', 'library' => 'fa-brands']],
        ['social_icon' => ['value' => 'fab fa-instagram', 'library' => 'fa-brands']],
        ['social_icon' => ['value' => 'fab fa-pinterest', 'library' => 'fa-brands']],
      ]])]),
    ]),
  ]],
  'testimonials' => ['Testimonials', [
    $heading('Kind words', 'h1'),
    $row([$column([$testimonial('Maria P.', 9)]), $column([$testimonial('Kostas D.', 8)]), $column([$testimonial('Sofia L.', 10)])]),
    $box([], [$widget('star-rating', ['rating' => 4.5, 'title' => 'Average rating'])]),
  ]],
  'features' => ['Features', [
    $heading('Why Lumen', 'h1'),
    $row([$column([$widget('image', ['image' => $images[6]])]), $box(['width' => ['unit' => '%', 'size' => 60]], [$heading('Native plants', 'h3', ['_animation' => 'fadeInLeft']), $text($paragraph)])]),
    $row([$box(['width' => ['unit' => '%', 'size' => 60]], [$heading('Low water', 'h3', ['_animation' => 'fadeInRight']), $text($paragraph)]), $column([$widget('image', ['image' => $images[7]])])]),
  ]],
  'skills' => ['Skills', [
    $heading('What we are good at', 'h1'),
    $box([], [$progress('Planting design', 80), $progress('Irrigation', 65), $progress('Tree care', 90)]),
  ]],
  'events' => ['Events', [
    $heading('Open garden days', 'h1'),
    $box([], [$widget('alert', ['alert_type' => 'info', 'alert_title' => 'Spring open day', 'alert_description' => 'Visit three of our gardens on the first Sunday of April.', 'show_dismiss' => 'hide'])]),
    $box([], [$widget('divider', []), $text($paragraph), $button('Book a visit')]),
  ]],
  'careers' => ['Careers', [
    $hero('Work with us', 11),
    $box([], [$text($paragraph), $widget('toggle', ['tabs' => $items(['Gardener', 'Designer'])])]),
  ]],
  'history' => ['History', [
    $heading('Twelve years of gardens', 'h1'),
    $row([$column([$counter_widget(2014, 'Founded')]), $column([$progress('Projects finished', 95)])]),
    $box([], [$carousel([7, 8, 9, 10])]),
  ]],
  'partners' => ['Partners', [
    $heading('Partners', 'h1'),
    $row([$column([$image_box(4, 'Nursery')]), $column([$image_box(5, 'Stone yard')]), $column([$image_box(6, 'Seed bank')])]),
  ]],
  'press' => ['Press', [
    $heading('In the press', 'h1'),
    $box([], [$widget('tabs', ['tabs' => $items(['Magazines', 'Radio'])]), $text($paragraph)]),
  ]],
  'offers' => ['Offers', [
    $heading('Seasonal offers', 'h1'),
    $row([$column([$icon_box('seedling', 'Spring planting')]), $column([$icon_box('sun', 'Summer care')]), $column([$icon_box('leaf', 'Autumn tidy')])]),
    $box([], [$text($paragraph), $button('Ask for an offer')]),
  ]],
  'projects' => ['Projects', [
    $heading('Projects', 'h1'),
    $box([], [$text($paragraph)]),
    $row([$column([$widget('image', ['image' => $images[1]])]), $column([$widget('image', ['image' => $images[2]])]), $column([$widget('image', ['image' => $images[3]])])]),
    $box([], [$text($paragraph)]),
    $box([], [$heading('A roof terrace in Athens', 'h2'), $text($paragraph)]),
    $box([
      'background_background' => 'classic', 'background_image' => $images[5], 'background_size' => 'cover',
      'background_position' => 'center center', 'min_height' => ['unit' => 'px', 'size' => 320],
      'justify_content' => 'center', 'css_classes' => 'lumen-banner',
    ], [$heading('Visit a finished garden', 'h2', ['title_color' => '#ffffff'])]),
  ]],
  'blog' => ['Blog', [
    $heading('Seasonal notes from our gardens', 'h1'),
    $box([], [$text($paragraph), $widget('image', ['image' => $images[4]]), $text($paragraph)]),
  ]],
  'shop' => ['Shop', [
    $heading('Garden shop', 'h1'),
    $row([
      $column([$image_box(1, 'Seed packs'), $button('Add to basket')]),
      $column([$image_box(2, 'Pots'), $button('Add to basket')]),
      $column([$image_box(3, 'Tools'), $button('Add to basket')]),
    ]),
  ]],
  'visit' => ['Visit', [
    $heading('Visit the nursery', 'h1'),
    $box([], [$text($paragraph), $widget('image', ['image' => $images[6]]), $text($paragraph)]),
    $box([], [$heading('Opening hours', 'h2'), $widget('html', ['html' => '<iframe src="/opening-hours/" title="Opening hours" loading="lazy" style="width:100%;height:220px;border:1px solid #ddd"></iframe>'])]),
  ]],
  // Shown only inside the iframe on the Visit page.
  'opening-hours' => ['Opening hours', [
    $box([], [$heading('Monday to Saturday', 'h3'), $text('9:00 to 17:00. Closed on Sundays and public holidays.')]),
  ]],
];

$order = 0;
foreach ($pages as $slug => [$title, $data]) {
  $id = wp_insert_post([
    'post_title' => $title, 'post_name' => $slug, 'post_type' => 'page', 'post_status' => 'publish',
    'post_content' => '', 'menu_order' => $order++, 'post_date' => '2026-01-01 09:00:00',
  ], TRUE);
  update_post_meta($id, '_wp_page_template', $slug === 'opening-hours' ? 'elementor_canvas' : 'elementor_header_footer');
  update_post_meta($id, '_elementor_edit_mode', 'builder');
  update_post_meta($id, '_elementor_template_type', 'wp-page');
  update_post_meta($id, '_elementor_version', ELEMENTOR_VERSION);
  update_post_meta($id, '_elementor_data', wp_slash(wp_json_encode($data)));
  if ($slug === 'home') {
    update_option('show_on_front', 'page');
    update_option('page_on_front', $id);
  }
}
// Regenerate Elementor's CSS files on the first visit of each page.
\Elementor\Plugin::$instance->files_manager->clear_cache();
echo 'Created ' . count($pages) . " Elementor pages.\n";
