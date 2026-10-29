UPDATE restaurants
SET image_url = CASE slug
    WHEN 'house-of-bangus' THEN '/images/bangus-relleno-all-natural-food.jpg'
    WHEN 'ciudad-elmina' THEN '/images/ciudad-elmina-food.jpg'
    WHEN 'matutina-gerrys' THEN '/images/matutina-s-and-gerry-food.jpg'
    ELSE image_url
  END,
  venue_image_url = CASE slug
    WHEN 'house-of-bangus' THEN '/images/bangus-relleno-all-natural-restaurant.jpg'
    WHEN 'ciudad-elmina' THEN '/images/ciudad-elmina-restaurant.jpg'
    WHEN 'matutina-gerrys' THEN '/images/matutina-s-and-gerry-restaurant.jpg'
    ELSE venue_image_url
  END
WHERE slug IN ('house-of-bangus', 'ciudad-elmina', 'matutina-gerrys');
